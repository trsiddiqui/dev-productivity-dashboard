import { eachDayOfInterval, formatISO, subDays } from 'date-fns';
import { extractJiraKeysFromPRs } from './contributions';
import { cfg } from './config';
import {
  DEV_BASE_BRANCH,
  getGithubCommitJiraKeys,
  getGithubPRsWithStats,
  getGithubReviewActivity,
} from './github';
import {
  getJiraIssueWorkflowInsights,
  getJiraIssuesAssignedToQa,
  getJiraIssuesByKeys,
  getJiraUsers,
  getQAAssignmentTimesAll,
  type JiraIssueWorkflowInsight,
} from './jira';
import { computeGithubAutomationSummary } from './qa';
import { getDevTeamRoster, getQaTeamRoster, type DevTeamRosterMember, type QaTeamRosterMember } from './team-rosters';
import {
  getTestRailCandidateRuns,
  getTestRailProjects,
  getTestRailResultsForRun,
  getTestRailStatuses,
  getTestRailUsers,
  parseTestRailTimespanToSeconds,
} from './testrail';
import type {
  JiraIssue,
  JiraUserLite,
  ManagementDeliveryDailyPoint,
  ManagementEngineeringMember,
  ManagementEngineeringSummary,
  ManagementMetricDefinition,
  ManagementOverviewResponse,
  ManagementQaMember,
  ManagementQaSummary,
  ManagementRiskDailyPoint,
  ManagementRiskSummary,
  PR,
  QaGithubAutomationSummary,
  TestRailProjectLite,
  TestRailStatusLite,
  TestRailUserLite,
} from './types';

const MANAGEMENT_TIMEZONE = process.env.MANAGEMENT_TIMEZONE || 'America/Winnipeg';
const ENGINEERING_PR_AGE_DAYS = 3;
const ACTIVE_ISSUE_AGE_DAYS = 5;
const REVIEW_SLA_HOURS = 24;
const ENGINEERING_LOOKBACK_DAYS = 180;
const WORKFLOW_STAGES = {
  todo: ['To Do', 'Open', 'Backlog', 'Selected for Development'],
  inProgress: ['In Progress', 'In Development', 'In-Progress', 'Doing', 'Selected for Development'],
  merged: ['Merged'],
  review: ['Reviewed', 'Review', 'In Review'],
  complete: ['Done', 'Approved'],
};
const REJECTED_DEFECT_TOKENS = [
  'duplicate',
  'invalid',
  'not a bug',
  "won't fix",
  'wont fix',
  'wontfix',
  'cannot reproduce',
  "can't reproduce",
  'works as designed',
  'as designed',
  'rejected',
];
const CLOSED_DEFECT_TOKENS = [
  'done',
  'closed',
  'resolved',
  'approved',
  'completed',
  'fixed',
];
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

interface EngineeringMemberDataset {
  member: ResolvedDevMember;
  mergedPrs: PR[];
  lookbackPrs: PR[];
  reviewActivity: Awaited<ReturnType<typeof getGithubReviewActivity>>;
  commitIssueKeys: string[];
}

interface QaMemberAccumulator {
  member: ResolvedQaMember;
  totalResults: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  otherStatuses: number;
  totalElapsedSeconds: number;
  defectsLinked: number;
  commentsLogged: number;
  uniqueTests: Set<number>;
  runsTouched: Set<number>;
  activeDays: Set<string>;
  elapsedSamples: number[];
  mixedOutcomeBucketsByTest: Map<number, Set<string>>;
  defectKeys: Set<string>;
  assignedIssues: JiraIssue[];
  queueWaitSamples: number[];
  qaCycleSamples: number[];
  qaBounceIssueCount: number;
  reopenedAfterSignoffCount: number;
  bugTurnaroundSamples: number[];
  githubAutomation: QaGithubAutomationSummary | null;
}

interface ResolvedDevMember extends DevTeamRosterMember {
  jiraUser?: JiraUserLite;
}

interface ResolvedQaMember extends QaTeamRosterMember {
  jiraUser?: JiraUserLite;
  testRailUser?: TestRailUserLite;
}

interface IssueSetDetails {
  originalIssuesByKey: Map<string, JiraIssue>;
  displayIssuesByKey: Map<string, JiraIssue>;
  displayIssues: JiraIssue[];
  workflowInsights: Record<string, JiraIssueWorkflowInsight>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function diffHours(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, (endMs - startMs) / 36e5);
}

function diffDays(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, (endMs - startMs) / (24 * 60 * 60 * 1000));
}

function normalize(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function dateOnly(iso?: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function dateTimeEnd(date: string): string {
  return `${date}T23:59:59Z`;
}

function isIsoWithinWindow(iso: string | null | undefined, from: string, to: string): boolean {
  const day = dateOnly(iso);
  return !!day && day >= from && day <= to;
}

function isWeekendInTimezone(iso: string, timezone: string): boolean {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date(iso));
  return day === 'Sat' || day === 'Sun';
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function parseDefectKeys(defects?: string): string[] {
  if (!defects) return [];
  const keys = defects.toUpperCase().match(JIRA_KEY_RE) ?? [];
  return unique(keys);
}

function countDefects(defects?: string): number {
  return parseDefectKeys(defects).length;
}

function statusBucket(status: TestRailStatusLite | undefined): 'passed' | 'failed' | 'blocked' | 'retest' | 'other' {
  const key = `${status?.label ?? ''} ${status?.name ?? ''}`.toLowerCase();
  if (key.includes('pass')) return 'passed';
  if (key.includes('fail')) return 'failed';
  if (key.includes('block')) return 'blocked';
  if (key.includes('retest')) return 'retest';
  return 'other';
}

function mapJiraUserByMember(jiraUsers: JiraUserLite[], member: { jiraEmail?: string; jiraDisplayName?: string; email?: string; name: string }): JiraUserLite | undefined {
  const email = normalize(member.jiraEmail ?? member.email);
  if (email) {
    const matchByEmail = jiraUsers.find((jiraUser) => normalize(jiraUser.emailAddress) === email);
    if (matchByEmail) return matchByEmail;
  }

  const displayName = normalize(member.jiraDisplayName ?? member.name);
  return jiraUsers.find((jiraUser) => normalize(jiraUser.displayName) === displayName);
}

function mapTestRailUserByMember(testRailUsers: TestRailUserLite[], member: QaTeamRosterMember): TestRailUserLite | undefined {
  const email = normalize(member.email);
  if (email) {
    const matchByEmail = testRailUsers.find((user) => normalize(user.email) === email);
    if (matchByEmail) return matchByEmail;
  }

  return testRailUsers.find((user) => normalize(user.name) === normalize(member.name));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await task(items[current]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

function computeWeekendActivityRate(prs: PR[], from: string, to: string): number | null {
  const events: string[] = [];
  for (const pr of prs) {
    if (isIsoWithinWindow(pr.createdAt, from, to)) events.push(pr.createdAt);
    if (isIsoWithinWindow(pr.mergedAt, from, to)) events.push(pr.mergedAt as string);
  }
  if (events.length === 0) return null;
  return events.filter((iso) => isWeekendInTimezone(iso, MANAGEMENT_TIMEZONE)).length / events.length;
}

function isClosedIssue(issue: JiraIssue): boolean {
  const haystack = `${normalize(issue.status)} ${normalize(issue.resolution)}`;
  return CLOSED_DEFECT_TOKENS.some((token) => haystack.includes(token));
}

function isRejectedDefect(issue: JiraIssue): boolean {
  const haystack = `${normalize(issue.status)} ${normalize(issue.resolution)}`;
  return REJECTED_DEFECT_TOKENS.some((token) => haystack.includes(token));
}

function buildDailySkeleton<T>(from: string, to: string, factory: (date: string) => T): Map<string, T> {
  return new Map(
    eachDayOfInterval({
      start: new Date(`${from}T00:00:00Z`),
      end: new Date(`${to}T00:00:00Z`),
    }).map((date) => {
      const key = formatISO(date, { representation: 'date' });
      return [key, factory(key)];
    }),
  );
}

function isPrOpenOnDay(pr: PR, day: string): boolean {
  const start = dateOnly(pr.createdAt);
  const end = dateOnly(pr.mergedAt ?? pr.closedAt ?? undefined);
  if (!start || start > day) return false;
  if (end && end <= day) return false;
  return true;
}

function isIssueActiveOnDay(issue: JiraIssue, day: string): boolean {
  const start = dateOnly(issue.reviewAt ?? issue.inProgressAt ?? issue.created);
  const end = dateOnly(issue.completeAt ?? issue.mergedAt ?? issue.resolutiondate ?? undefined);
  if (!start || start > day) return false;
  if (end && end <= day) return false;
  return true;
}

function daysOpenAtDay(startIso: string | null | undefined, day: string): number | null {
  if (!startIso) return null;
  return diffDays(startIso, dateTimeEnd(day));
}

async function buildIssueSetDetails(issueKeys: string[]): Promise<IssueSetDetails> {
  if (issueKeys.length === 0) {
    return {
      originalIssuesByKey: new Map(),
      displayIssuesByKey: new Map(),
      displayIssues: [],
      workflowInsights: {},
    };
  }

  const originalIssues = await getJiraIssuesByKeys(issueKeys);
  const parentKeys = unique(
    originalIssues
      .filter((issue) => issue.isSubtask && !!issue.parentKey)
      .map((issue) => issue.parentKey as string),
  );
  const parentIssues = parentKeys.length > 0 ? await getJiraIssuesByKeys(parentKeys) : [];
  const parentByKey = new Map(parentIssues.map((issue) => [issue.key, issue]));
  const displayIssuesByKey = new Map<string, JiraIssue>();
  const originalIssuesByKey = new Map(originalIssues.map((issue) => [issue.key, issue]));

  for (const issue of originalIssues) {
    if (issue.isSubtask && issue.parentKey && parentByKey.has(issue.parentKey)) {
      displayIssuesByKey.set(issue.key, parentByKey.get(issue.parentKey)!);
      continue;
    }
    displayIssuesByKey.set(issue.key, issue);
  }

  const displayIssues = Array.from(
    new Map(
      Array.from(displayIssuesByKey.values()).map((issue) => [issue.key, issue]),
    ).values(),
  )
    .sort((left, right) => left.key.localeCompare(right.key));
  const workflowInsights = await getJiraIssueWorkflowInsights({
    issueKeys: displayIssues.map((issue) => issue.key),
    stages: WORKFLOW_STAGES,
  });

  for (const issue of displayIssues) {
    const workflow = workflowInsights[issue.key];
    if (!workflow) continue;
    issue.todoAt = workflow.todoAt;
    issue.inProgressAt = workflow.inProgressAt;
    issue.mergedAt = workflow.mergedAt;
    issue.reviewAt = workflow.reviewAt;
    issue.completeAt = workflow.completeAt;
    issue.status = workflow.status ?? issue.status;
    issue.resolution = workflow.resolution ?? issue.resolution;
  }

  return {
    originalIssuesByKey,
    displayIssuesByKey,
    displayIssues,
    workflowInsights,
  };
}

async function loadEngineeringDatasets(params: {
  from: string;
  to: string;
  warnings: string[];
}): Promise<EngineeringMemberDataset[]> {
  const { from, to, warnings } = params;
  const jiraUsers = await getJiraUsers().catch((error) => {
    warnings.push(`Jira user directory unavailable for developer roster mapping: ${error instanceof Error ? error.message : String(error)}`);
    return [] as JiraUserLite[];
  });
  const roster = getDevTeamRoster();
  const resolvedMembers: ResolvedDevMember[] = roster.members.map((member) => ({
    ...member,
    jiraUser: mapJiraUserByMember(jiraUsers, member),
  }));
  const lookbackFrom = formatISO(subDays(new Date(`${from}T00:00:00Z`), ENGINEERING_LOOKBACK_DAYS), {
    representation: 'date',
  });

  return mapWithConcurrency(resolvedMembers, 3, async (member) => {
    const [mergedPrs, lookbackPrs, reviewActivity, commitIssueKeys] = await Promise.all([
      getGithubPRsWithStats({
        login: member.githubLogin,
        from,
        to,
        baseBranch: DEV_BASE_BRANCH,
        mergedOnly: true,
        dateField: 'merged',
      }).catch((error) => {
        warnings.push(`GitHub merged PRs unavailable for ${member.name}: ${error instanceof Error ? error.message : String(error)}`);
        return [] as PR[];
      }),
      getGithubPRsWithStats({
        login: member.githubLogin,
        from: lookbackFrom,
        to,
        baseBranch: DEV_BASE_BRANCH,
        mergedOnly: false,
        dateField: 'created',
      }).catch((error) => {
        warnings.push(`GitHub open-PR lookback unavailable for ${member.name}: ${error instanceof Error ? error.message : String(error)}`);
        return [] as PR[];
      }),
      getGithubReviewActivity({
        login: member.githubLogin,
        from,
        to,
        baseBranch: DEV_BASE_BRANCH,
      }).catch((error) => {
        warnings.push(`GitHub review activity unavailable for ${member.name}: ${error instanceof Error ? error.message : String(error)}`);
        return {
          totalReviews: 0,
          approvals: 0,
          changesRequested: 0,
          comments: 0,
          reviewedPRs: 0,
          reviewComments: 0,
        };
      }),
      getGithubCommitJiraKeys({
        login: member.githubLogin,
        from,
        to,
      }).catch((error) => {
        warnings.push(`GitHub commit-linked Jira keys unavailable for ${member.name}: ${error instanceof Error ? error.message : String(error)}`);
        return [] as string[];
      }),
    ]);

    return {
      member,
      mergedPrs,
      lookbackPrs,
      reviewActivity,
      commitIssueKeys,
    };
  });
}

function buildEngineeringSummary(params: {
  datasets: EngineeringMemberDataset[];
  issueDetails: IssueSetDetails;
  from: string;
  to: string;
}): {
  summary: ManagementEngineeringSummary;
  members: ManagementEngineeringMember[];
  mergedPrDaily: Map<string, number>;
  lookbackPrs: PR[];
  touchedDisplayIssueKeys: Set<string>;
} {
  const { datasets, issueDetails, from, to } = params;
  const mergedPrs = datasets.flatMap((dataset) => dataset.mergedPrs);
  const lookbackPrs = datasets.flatMap((dataset) => dataset.lookbackPrs);
  const allTouchedDisplayIssueKeys = new Set<string>();
  const mergedPrDaily = new Map<string, number>();
  const touchPointsByDisplayKey = new Map(issueDetails.displayIssues.map((issue) => [issue.key, issue.storyPoints ?? 0]));

  for (const pr of mergedPrs) {
    const key = dateOnly(pr.mergedAt);
    if (!key) continue;
    mergedPrDaily.set(key, (mergedPrDaily.get(key) ?? 0) + 1);
  }

  const members: ManagementEngineeringMember[] = datasets.map((dataset) => {
    const windowOpenedPrs = dataset.lookbackPrs.filter((pr) => isIsoWithinWindow(pr.createdAt, from, to));
    const touchedIssueKeys = new Set([
      ...extractJiraKeysFromPRs(windowOpenedPrs),
      ...dataset.commitIssueKeys,
    ]);
    const touchedDisplayIssueKeys = new Set<string>();
    for (const issueKey of touchedIssueKeys) {
      const displayIssue = issueDetails.displayIssuesByKey.get(issueKey);
      if (!displayIssue) continue;
      touchedDisplayIssueKeys.add(displayIssue.key);
      allTouchedDisplayIssueKeys.add(displayIssue.key);
    }

    const touchedTicketStoryPoints = Array.from(touchedDisplayIssueKeys)
      .reduce((total, key) => total + (touchPointsByDisplayKey.get(key) ?? 0), 0);
    const reviewResponseSamples = dataset.mergedPrs
      .map((pr) => diffHours(pr.lastCommitAt ?? pr.readyForReviewAt ?? pr.createdAt, pr.firstReviewAt))
      .filter((value): value is number => value !== null);
    const leadTimeSamples = dataset.mergedPrs
      .map((pr) => diffHours(pr.firstCommitAt ?? pr.createdAt, pr.mergedAt))
      .filter((value): value is number => value !== null);
    const changesRequestedRate = percent(
      dataset.mergedPrs.filter((pr) => (pr.changesRequestedCount ?? 0) > 0).length,
      dataset.mergedPrs.filter((pr) => (pr.reviewCount ?? 0) > 0).length,
    );
    const agingOpenPrCount = dataset.lookbackPrs.filter((pr) => (
      isPrOpenOnDay(pr, to)
      && (daysOpenAtDay(pr.createdAt, to) ?? 0) >= ENGINEERING_PR_AGE_DAYS
    )).length;
    const reopenedIssueCount = Array.from(touchedDisplayIssueKeys)
      .filter((key) => (issueDetails.workflowInsights[key]?.reopenedCount ?? 0) > 0)
      .length;

    return {
      alias: dataset.member.alias,
      name: dataset.member.name,
      githubLogin: dataset.member.githubLogin,
      jiraDisplayName: dataset.member.jiraUser?.displayName ?? dataset.member.jiraDisplayName,
      mergedPrs: dataset.mergedPrs.length,
      touchedTicketStoryPoints,
      medianLeadTimeHours: median(leadTimeSamples),
      medianReviewResponseHours: median(reviewResponseSamples),
      changesRequestedRate,
      agingOpenPrCount,
      reopenedIssueCount,
      weekendActivityRate: computeWeekendActivityRate(dataset.lookbackPrs.filter((pr) => isIsoWithinWindow(pr.createdAt, from, to) || isIsoWithinWindow(pr.mergedAt, from, to)), from, to),
      totalReviewsGiven: dataset.reviewActivity.totalReviews,
      totalReviewCommentsGiven: dataset.reviewActivity.reviewComments,
    };
  }).sort((left, right) => (
    right.touchedTicketStoryPoints - left.touchedTicketStoryPoints
    || right.mergedPrs - left.mergedPrs
    || left.name.localeCompare(right.name)
  ));

  const reviewResponseSamples = mergedPrs
    .map((pr) => diffHours(pr.lastCommitAt ?? pr.readyForReviewAt ?? pr.createdAt, pr.firstReviewAt))
    .filter((value): value is number => value !== null);
  const reviewToMergeSamples = mergedPrs
    .map((pr) => diffHours(pr.firstReviewAt, pr.mergedAt))
    .filter((value): value is number => value !== null);
  const leadTimeSamples = mergedPrs
    .map((pr) => diffHours(pr.firstCommitAt ?? pr.createdAt, pr.mergedAt))
    .filter((value): value is number => value !== null);
  const reviewSlaEligible = mergedPrs
    .map((pr) => diffHours(pr.readyForReviewAt ?? pr.createdAt, pr.firstReviewAt))
    .filter((value): value is number => value !== null);
  const agingOpenPrCount = lookbackPrs.filter((pr) => (
    isPrOpenOnDay(pr, to)
    && (daysOpenAtDay(pr.createdAt, to) ?? 0) >= ENGINEERING_PR_AGE_DAYS
  )).length;
  const agingActiveIssueCount = issueDetails.displayIssues.filter((issue) => (
    isIssueActiveOnDay(issue, to)
    && (daysOpenAtDay(issue.reviewAt ?? issue.inProgressAt ?? issue.created, to) ?? 0) >= ACTIVE_ISSUE_AGE_DAYS
  )).length;
  const reopenedIssueCount = issueDetails.displayIssues.filter((issue) => (
    (issueDetails.workflowInsights[issue.key]?.reopenedCount ?? 0) > 0
  )).length;
  const totalReviewsGiven = datasets.reduce((total, dataset) => total + dataset.reviewActivity.totalReviews, 0);
  const totalReviewCommentsGiven = datasets.reduce((total, dataset) => total + dataset.reviewActivity.reviewComments, 0);

  const summary: ManagementEngineeringSummary = {
    developerCount: datasets.length,
    mergedPrs: mergedPrs.length,
    touchedTicketStoryPoints: Array.from(allTouchedDisplayIssueKeys).reduce((total, key) => total + (touchPointsByDisplayKey.get(key) ?? 0), 0),
    medianLeadTimeHours: median(leadTimeSamples),
    medianReviewResponseHours: median(reviewResponseSamples),
    medianReviewToMergeHours: median(reviewToMergeSamples),
    changesRequestedRate: percent(
      mergedPrs.filter((pr) => (pr.changesRequestedCount ?? 0) > 0).length,
      mergedPrs.filter((pr) => (pr.reviewCount ?? 0) > 0).length,
    ),
    reviewSlaHitRate: percent(
      reviewSlaEligible.filter((hours) => hours <= REVIEW_SLA_HOURS).length,
      reviewSlaEligible.length,
    ),
    agingOpenPrCount,
    agingActiveIssueCount,
    reopenedWorkRate: percent(reopenedIssueCount, issueDetails.displayIssues.length),
    weekendActivityRate: computeWeekendActivityRate(lookbackPrs.filter((pr) => isIsoWithinWindow(pr.createdAt, from, to) || isIsoWithinWindow(pr.mergedAt, from, to)), from, to),
    totalReviewsGiven,
    totalReviewCommentsGiven,
  };

  return {
    summary,
    members,
    mergedPrDaily,
    lookbackPrs,
    touchedDisplayIssueKeys: allTouchedDisplayIssueKeys,
  };
}

function resolveQaProject(projects: TestRailProjectLite[], requestedProjectId?: number | null): TestRailProjectLite | null {
  if (requestedProjectId) {
    return projects.find((project) => project.id === requestedProjectId) ?? null;
  }

  const defaultProjectName = normalize(getQaTeamRoster().defaultProject);
  if (defaultProjectName) {
    const defaultProject = projects.find((project) => normalize(project.name) === defaultProjectName);
    if (defaultProject) return defaultProject;
  }

  return projects[0] ?? null;
}

async function buildQaAccumulator(params: {
  from: string;
  to: string;
  requestedProjectId?: number | null;
  warnings: string[];
}): Promise<{
  summary: ManagementQaSummary;
  members: ManagementQaMember[];
  qaDaily: Map<string, { qaResults: number; defectsLinked: number }>;
  qaProjects: TestRailProjectLite[];
  selectedProject: TestRailProjectLite | null;
  assignedIssues: JiraIssue[];
  workflowInsights: Record<string, JiraIssueWorkflowInsight>;
  rejectedDefectCount: number;
}> {
  const { from, to, requestedProjectId, warnings } = params;
  const [projects, statuses, jiraUsers] = await Promise.all([
    getTestRailProjects().catch((error) => {
      warnings.push(`TestRail projects unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [] as TestRailProjectLite[];
    }),
    getTestRailStatuses().catch((error) => {
      warnings.push(`TestRail statuses unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [] as TestRailStatusLite[];
    }),
    getJiraUsers().catch((error) => {
      warnings.push(`Jira user directory unavailable for QA roster mapping: ${error instanceof Error ? error.message : String(error)}`);
      return [] as JiraUserLite[];
    }),
  ]);
  const selectedProject = resolveQaProject(projects, requestedProjectId);
  if (!selectedProject) {
    return {
      summary: {
        qaCount: getQaTeamRoster().members.length,
        projectId: null,
        totalResults: 0,
        uniqueTests: 0,
        passRate: null,
        failurePressureRate: null,
        defectsLinked: 0,
        assignedTicketCount: 0,
        assignedStoryPoints: 0,
        medianQueueWaitHours: null,
        medianQaCycleHours: null,
        qaBounceRate: null,
        reopenedAfterSignoffRate: null,
        medianBugTurnaroundHours: null,
        defectRejectionRate: null,
        automationCoverageBreadth: 0,
        automationMaintenanceRatio: null,
        mixedOutcomeTestRate: null,
      },
      members: [],
      qaDaily: buildDailySkeleton(from, to, () => ({ qaResults: 0, defectsLinked: 0 })),
      qaProjects: projects,
      selectedProject: null,
      assignedIssues: [],
      workflowInsights: {},
      rejectedDefectCount: 0,
    };
  }

  const testRailUsers = await getTestRailUsers(selectedProject.id).catch((error) => {
    warnings.push(`TestRail users unavailable for ${selectedProject.name}: ${error instanceof Error ? error.message : String(error)}`);
    return [] as TestRailUserLite[];
  });
  const roster = getQaTeamRoster();
  const resolvedMembers: ResolvedQaMember[] = roster.members.map((member) => ({
    ...member,
    jiraUser: mapJiraUserByMember(jiraUsers, member),
    testRailUser: mapTestRailUserByMember(testRailUsers, member),
  }));
  const accumulators = new Map<string, QaMemberAccumulator>(
    resolvedMembers.map((member) => [member.alias, {
      member,
      totalResults: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      retest: 0,
      otherStatuses: 0,
      totalElapsedSeconds: 0,
      defectsLinked: 0,
      commentsLogged: 0,
      uniqueTests: new Set<number>(),
      runsTouched: new Set<number>(),
      activeDays: new Set<string>(),
      elapsedSamples: [],
      mixedOutcomeBucketsByTest: new Map<number, Set<string>>(),
      defectKeys: new Set<string>(),
      assignedIssues: [],
      queueWaitSamples: [],
      qaCycleSamples: [],
      qaBounceIssueCount: 0,
      reopenedAfterSignoffCount: 0,
      bugTurnaroundSamples: [],
      githubAutomation: null,
    }]),
  );
  const teamMixedOutcomeBucketsByTest = new Map<number, Set<string>>();
  const qaDaily = buildDailySkeleton(from, to, () => ({ qaResults: 0, defectsLinked: 0 }));
  const fromTimestamp = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const toTimestamp = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  const candidateRuns = await getTestRailCandidateRuns({
    projectId: selectedProject.id,
    fromTimestamp,
    toTimestamp,
  }).catch((error) => {
    warnings.push(`TestRail runs unavailable for ${selectedProject.name}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });
  const createdByIds = unique(resolvedMembers
    .map((member) => member.testRailUser?.id)
    .filter((value): value is number => typeof value === 'number'));
  const statusById = new Map(statuses.map((status) => [status.id, status]));

  if (candidateRuns.length > 0 && createdByIds.length > 0) {
    const resultsByRun = await mapWithConcurrency(candidateRuns, 5, (run) => getTestRailResultsForRun({
      runId: run.id,
      fromTimestamp,
      toTimestamp,
      createdByIds,
    }).catch((error) => {
      warnings.push(`TestRail results unavailable for run ${run.id}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }));

    for (const [index, run] of candidateRuns.entries()) {
      for (const result of resultsByRun[index]) {
        const accumulator = resolvedMembers
          .map((member) => accumulators.get(member.alias)!)
          .find((entry) => entry.member.testRailUser?.id === result.createdBy);
        if (!accumulator) continue;

        accumulator.totalResults += 1;
        accumulator.uniqueTests.add(result.testId);
        accumulator.runsTouched.add(run.id);
        const day = formatISO(new Date(result.createdOn * 1000), { representation: 'date' });
        accumulator.activeDays.add(day);
        const dayRow = qaDaily.get(day);
        if (dayRow) {
          dayRow.qaResults += 1;
          dayRow.defectsLinked += countDefects(result.defects);
        }

        const bucket = statusBucket(statusById.get(result.statusId));
        if (bucket === 'passed') accumulator.passed += 1;
        if (bucket === 'failed') accumulator.failed += 1;
        if (bucket === 'blocked') accumulator.blocked += 1;
        if (bucket === 'retest') accumulator.retest += 1;
        if (bucket === 'other') accumulator.otherStatuses += 1;

        const teamBucketSet = teamMixedOutcomeBucketsByTest.get(result.testId) ?? new Set<string>();
        teamBucketSet.add(bucket);
        teamMixedOutcomeBucketsByTest.set(result.testId, teamBucketSet);
        const memberBucketSet = accumulator.mixedOutcomeBucketsByTest.get(result.testId) ?? new Set<string>();
        memberBucketSet.add(bucket);
        accumulator.mixedOutcomeBucketsByTest.set(result.testId, memberBucketSet);

        const elapsedSeconds = parseTestRailTimespanToSeconds(result.elapsed);
        if (elapsedSeconds !== null) {
          accumulator.totalElapsedSeconds += elapsedSeconds;
          accumulator.elapsedSamples.push(elapsedSeconds);
        }

        if (result.comment?.trim()) accumulator.commentsLogged += 1;
        accumulator.defectsLinked += countDefects(result.defects);
        for (const defectKey of parseDefectKeys(result.defects)) {
          accumulator.defectKeys.add(defectKey);
        }
      }
    }
  }

  const assignedIssuesByAlias = new Map<string, JiraIssue[]>();
  await mapWithConcurrency(resolvedMembers, 3, async (member) => {
    if (!member.jiraUser) {
      assignedIssuesByAlias.set(member.alias, []);
      warnings.push(`Jira roster mapping missing for QA member ${member.name}.`);
      return;
    }

    const issues = await getJiraIssuesAssignedToQa({
      from,
      to,
      jiraUser: member.jiraUser,
    }).catch((error) => {
      warnings.push(`Jira assigned issues unavailable for ${member.name}: ${error instanceof Error ? error.message : String(error)}`);
      return [] as JiraIssue[];
    });
    assignedIssuesByAlias.set(member.alias, issues);
  });

  const allAssignedIssueKeys = unique(Array.from(assignedIssuesByAlias.values()).flat().map((issue) => issue.key));
  const issueDetails = await buildIssueSetDetails(allAssignedIssueKeys);
  let qaAssignmentTimes: Record<string, Record<string, string | undefined>> = {};
  if (allAssignedIssueKeys.length > 0 && cfg.jiraQAAssigneeField) {
    qaAssignmentTimes = await getQAAssignmentTimesAll(
      issueDetails.displayIssues
        .filter((issue) => (issue.qaAssignees?.length ?? 0) > 0)
        .map((issue) => ({ key: issue.key, qa: issue.qaAssignees ?? [] })),
      cfg.jiraQAAssigneeField,
    ).catch((error) => {
      warnings.push(`Jira QA assignment-time history unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    });
  }

  for (const [alias, issues] of assignedIssuesByAlias.entries()) {
    const accumulator = accumulators.get(alias);
    if (!accumulator) continue;
    const displayIssues = unique(issues
      .map((issue) => issueDetails.displayIssuesByKey.get(issue.key)?.key ?? issue.key))
      .map((key) => issueDetails.displayIssues.find((issue) => issue.key === key))
      .filter((issue): issue is JiraIssue => !!issue);

    accumulator.assignedIssues = displayIssues;
    for (const issue of displayIssues) {
      const workflow = issueDetails.workflowInsights[issue.key];
      const qaIdentity = accumulator.member.jiraUser
        ? `id:${accumulator.member.jiraUser.accountId}`
        : `name:${normalize(accumulator.member.name)}`;
      const reviewStart = workflow?.reviewAt ?? workflow?.completeAt ?? issue.reviewAt ?? issue.completeAt;
      const assignedAt = qaAssignmentTimes[issue.key]?.[qaIdentity];
      const effectiveQueueWait = reviewStart
        ? Math.max(0, diffHours(reviewStart, assignedAt ?? reviewStart) ?? 0)
        : null;
      const cycleStart = assignedAt && reviewStart && new Date(assignedAt).getTime() > new Date(reviewStart).getTime()
        ? assignedAt
        : reviewStart;
      const qaCycle = diffHours(cycleStart, workflow?.completeAt ?? issue.completeAt);

      if (effectiveQueueWait !== null) accumulator.queueWaitSamples.push(effectiveQueueWait);
      if (qaCycle !== null) accumulator.qaCycleSamples.push(qaCycle);
      if ((workflow?.backflowCount ?? 0) > 0) accumulator.qaBounceIssueCount += 1;
      if (workflow?.reopenedAfterComplete) accumulator.reopenedAfterSignoffCount += 1;

      const bugTurnaround = normalize(issue.issueType) === 'bug'
        ? diffHours(workflow?.created ?? issue.created, workflow?.completeAt ?? issue.completeAt)
        : null;
      if (bugTurnaround !== null) accumulator.bugTurnaroundSamples.push(bugTurnaround);
    }
  }

  await mapWithConcurrency(resolvedMembers, 3, async (member) => {
    const accumulator = accumulators.get(member.alias);
    if (!accumulator || !member.githubLogin) return;
    accumulator.githubAutomation = await computeGithubAutomationSummary({
      login: member.githubLogin,
      from,
      to,
    }).catch((error) => {
      warnings.push(`GitHub automation metrics unavailable for ${member.name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
  });

  const allDefectKeys = unique(Array.from(accumulators.values()).flatMap((accumulator) => Array.from(accumulator.defectKeys)));
  const defectIssues = allDefectKeys.length > 0
    ? await getJiraIssuesByKeys(allDefectKeys).catch((error) => {
      warnings.push(`Linked defect Jira issues unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [] as JiraIssue[];
    })
    : [];
  const closedDefects = defectIssues.filter(isClosedIssue);
  const rejectedDefects = closedDefects.filter(isRejectedDefect);
  let bugTurnaroundFallbackSamples: number[] = [];
  if (defectIssues.length > 0) {
    const defectWorkflows = await getJiraIssueWorkflowInsights({
      issueKeys: defectIssues.map((issue) => issue.key),
      stages: WORKFLOW_STAGES,
    }).catch((error) => {
      warnings.push(`Linked defect workflow history unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return {} as Record<string, JiraIssueWorkflowInsight>;
    });
    bugTurnaroundFallbackSamples = defectIssues
      .filter((issue) => normalize(issue.issueType) === 'bug')
      .map((issue) => diffHours(defectWorkflows[issue.key]?.created ?? issue.created, defectWorkflows[issue.key]?.completeAt ?? issue.completeAt ?? issue.resolutiondate))
      .filter((value): value is number => value !== null);
  }

  const members: ManagementQaMember[] = Array.from(accumulators.values()).map((accumulator) => {
    const totalResults = accumulator.totalResults;
    const mixedOutcomeTests = Array.from(accumulator.mixedOutcomeBucketsByTest.values())
      .filter((buckets) => buckets.size > 1)
      .length;
    const automationCoverageBreadth = accumulator.githubAutomation?.featureCoverageBreadth ?? 0;
    const automationMaintenanceRatio = accumulator.githubAutomation
      ? percent(
        accumulator.githubAutomation.engineeringFilesChanged,
        accumulator.githubAutomation.engineeringFilesChanged + accumulator.githubAutomation.testAssetFilesChanged,
      )
      : null;

    return {
      alias: accumulator.member.alias,
      name: accumulator.member.name,
      githubLogin: accumulator.member.githubLogin,
      jiraDisplayName: accumulator.member.jiraUser?.displayName,
      testRailUserName: accumulator.member.testRailUser?.name,
      totalResults,
      uniqueTests: accumulator.uniqueTests.size,
      passRate: percent(accumulator.passed, totalResults),
      failurePressureRate: percent(accumulator.failed + accumulator.retest, totalResults),
      defectsLinked: accumulator.defectsLinked,
      assignedTicketCount: accumulator.assignedIssues.length,
      assignedStoryPoints: accumulator.assignedIssues.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0),
      medianQueueWaitHours: median(accumulator.queueWaitSamples),
      medianQaCycleHours: median(accumulator.qaCycleSamples),
      qaBounceIssueCount: accumulator.qaBounceIssueCount,
      reopenedAfterSignoffCount: accumulator.reopenedAfterSignoffCount,
      medianBugTurnaroundHours: median(accumulator.bugTurnaroundSamples),
      automationCoverageBreadth,
      automationMaintenanceRatio,
      mixedOutcomeTestRate: percent(mixedOutcomeTests, accumulator.uniqueTests.size),
    };
  }).sort((left, right) => (
    right.assignedStoryPoints - left.assignedStoryPoints
    || right.totalResults - left.totalResults
    || left.name.localeCompare(right.name)
  ));

  const teamAssignedIssueKeys = unique(Array.from(accumulators.values()).flatMap((accumulator) => accumulator.assignedIssues.map((issue) => issue.key)));
  const teamAssignedIssues = teamAssignedIssueKeys
    .map((key) => issueDetails.displayIssues.find((issue) => issue.key === key))
    .filter((issue): issue is JiraIssue => !!issue);
  const totalResults = Array.from(accumulators.values()).reduce((total, accumulator) => total + accumulator.totalResults, 0);
  const totalPassed = Array.from(accumulators.values()).reduce((total, accumulator) => total + accumulator.passed, 0);
  const totalFailurePressure = Array.from(accumulators.values()).reduce((total, accumulator) => total + accumulator.failed + accumulator.retest, 0);
  const totalDefectsLinked = Array.from(accumulators.values()).reduce((total, accumulator) => total + accumulator.defectsLinked, 0);
  const queueWaitSamples = Array.from(accumulators.values()).flatMap((accumulator) => accumulator.queueWaitSamples);
  const qaCycleSamples = Array.from(accumulators.values()).flatMap((accumulator) => accumulator.qaCycleSamples);
  const bugTurnaroundSamples = Array.from(accumulators.values()).flatMap((accumulator) => accumulator.bugTurnaroundSamples);
  const mixedOutcomeTests = Array.from(teamMixedOutcomeBucketsByTest.values()).filter((buckets) => buckets.size > 1).length;
  const automationSummaries = Array.from(accumulators.values())
    .map((accumulator) => accumulator.githubAutomation)
    .filter((summary): summary is QaGithubAutomationSummary => !!summary);
  const automationFeatureAreas = new Set(automationSummaries.flatMap((summary) => summary.featureAreas ?? []));
  const totalEngineeringFilesChanged = automationSummaries.reduce((total, summary) => total + summary.engineeringFilesChanged, 0);
  const totalTestAssetFilesChanged = automationSummaries.reduce((total, summary) => total + summary.testAssetFilesChanged, 0);
  const teamQaBounceIssueCount = Array.from(accumulators.values()).reduce((total, accumulator) => total + accumulator.qaBounceIssueCount, 0);
  const teamReopenedAfterSignoffCount = Array.from(accumulators.values()).reduce((total, accumulator) => total + accumulator.reopenedAfterSignoffCount, 0);
  const bugTurnaround = bugTurnaroundSamples.length > 0 ? bugTurnaroundSamples : bugTurnaroundFallbackSamples;

  const summary: ManagementQaSummary = {
    qaCount: resolvedMembers.length,
    projectId: selectedProject.id,
    projectName: selectedProject.name,
    totalResults,
    uniqueTests: teamMixedOutcomeBucketsByTest.size,
    passRate: percent(totalPassed, totalResults),
    failurePressureRate: percent(totalFailurePressure, totalResults),
    defectsLinked: totalDefectsLinked,
    assignedTicketCount: teamAssignedIssues.length,
    assignedStoryPoints: teamAssignedIssues.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0),
    medianQueueWaitHours: median(queueWaitSamples),
    medianQaCycleHours: median(qaCycleSamples),
    qaBounceRate: percent(teamQaBounceIssueCount, teamAssignedIssues.length),
    reopenedAfterSignoffRate: percent(teamReopenedAfterSignoffCount, teamAssignedIssues.filter((issue) => !!issue.completeAt).length),
    medianBugTurnaroundHours: median(bugTurnaround),
    defectRejectionRate: percent(rejectedDefects.length, closedDefects.length),
    automationCoverageBreadth: automationFeatureAreas.size,
    automationMaintenanceRatio: percent(totalEngineeringFilesChanged, totalEngineeringFilesChanged + totalTestAssetFilesChanged),
    mixedOutcomeTestRate: percent(mixedOutcomeTests, teamMixedOutcomeBucketsByTest.size),
  };

  return {
    summary,
    members,
    qaDaily,
    qaProjects: projects,
    selectedProject,
    assignedIssues: teamAssignedIssues,
    workflowInsights: issueDetails.workflowInsights,
    rejectedDefectCount: rejectedDefects.length,
  };
}

function buildRiskDaily(params: {
  from: string;
  to: string;
  lookbackPrs: PR[];
  issues: JiraIssue[];
  workflows: Record<string, JiraIssueWorkflowInsight>;
}): ManagementRiskDailyPoint[] {
  const { from, to, lookbackPrs, issues, workflows } = params;
  const map = buildDailySkeleton(from, to, (date) => ({
    date,
    agingOpenPrs: 0,
    agingActiveIssues: 0,
    reopenedIssues: 0,
    qaBounceIssues: 0,
  }));

  for (const [date, row] of map.entries()) {
    row.agingOpenPrs = lookbackPrs.filter((pr) => (
      isPrOpenOnDay(pr, date)
      && (daysOpenAtDay(pr.createdAt, date) ?? 0) >= ENGINEERING_PR_AGE_DAYS
    )).length;
    row.agingActiveIssues = issues.filter((issue) => (
      isIssueActiveOnDay(issue, date)
      && (daysOpenAtDay(issue.reviewAt ?? issue.inProgressAt ?? issue.created, date) ?? 0) >= ACTIVE_ISSUE_AGE_DAYS
    )).length;
  }

  for (const workflow of Object.values(workflows)) {
    for (const date of workflow.reopenedDates ?? []) {
      const key = dateOnly(date);
      if (!key || !map.has(key)) continue;
      map.get(key)!.reopenedIssues += 1;
    }
    for (const date of workflow.backflowDates ?? []) {
      const key = dateOnly(date);
      if (!key || !map.has(key)) continue;
      map.get(key)!.qaBounceIssues += 1;
    }
  }

  return Array.from(map.values());
}

function buildMetricDefinitions(): ManagementMetricDefinition[] {
  return [
    {
      id: 'engineering-lead-time',
      name: 'Engineering lead time',
      category: 'Delivery',
      description: 'Median time from first commit to merged PR for tracked-base engineering work.',
      derivation: 'Median of first commit to merged timestamp across merged PRs into the tracked base branch.',
    },
    {
      id: 'engineering-review-response',
      name: 'Review response',
      category: 'Collaboration',
      description: 'Median wait from the last code push to first review.',
      derivation: 'Median of last commit to first review timestamp across merged PRs with review activity.',
    },
    {
      id: 'engineering-review-sla',
      name: 'Review SLA hit rate',
      category: 'Collaboration',
      description: 'Share of PRs that receive a first review within 24 hours of ready-for-review or PR creation.',
      derivation: 'PRs with first review in 24 hours divided by reviewed PRs in the selected window.',
    },
    {
      id: 'engineering-aging-prs',
      name: 'Aging open PRs',
      category: 'Risk',
      description: 'Open pull requests older than three days as of the end of the selected window.',
      derivation: 'Count of PRs still open on the selected end date with at least three days of age.',
    },
    {
      id: 'engineering-reopened-work',
      name: 'Reopened work rate',
      category: 'Quality',
      description: 'Share of touched Jira tickets that moved out of a completed state and had to be reopened.',
      derivation: 'Issues with a complete-state exit divided by touched canonical Jira tickets.',
    },
    {
      id: 'qa-queue-wait',
      name: 'QA queue wait',
      category: 'QA',
      description: 'Median time between review-ready work and QA assignment/start.',
      derivation: 'Median of review-to-assignment gap, assuming zero wait when Jira shows the QA already assigned before review.',
    },
    {
      id: 'qa-cycle-time',
      name: 'QA cycle time',
      category: 'QA',
      description: 'Median time for QA to take reviewed work through to completion.',
      derivation: 'Median of assignment-or-review start to completed status across Jira tickets assigned to QA.',
    },
    {
      id: 'qa-bounce-rate',
      name: 'QA bounce rate',
      category: 'Quality',
      description: 'Share of QA-assigned tickets that bounced back from review/completed states into active work.',
      derivation: 'Issues with at least one backflow from review/completed into todo or in-progress divided by QA-assigned tickets.',
    },
    {
      id: 'qa-defect-rejection',
      name: 'Defect rejection rate',
      category: 'Quality',
      description: 'Share of closed TestRail-linked defects that ended in duplicate/invalid/wont-fix style outcomes.',
      derivation: 'Rejected closed defects divided by closed Jira defects linked from TestRail results.',
    },
    {
      id: 'qa-automation-maintenance',
      name: 'Automation maintenance ratio',
      category: 'Automation',
      description: 'How much automation effort went into framework/CI maintenance instead of net-new test assets.',
      derivation: 'Engineering files changed divided by engineering plus test-asset files changed in the QA automation repository.',
    },
  ];
}

export async function computeManagementOverview(params: {
  from: string;
  to: string;
  projectId?: number | null;
}): Promise<ManagementOverviewResponse> {
  const { from, to, projectId } = params;
  const warnings: string[] = [];
  const engineeringDatasets = await loadEngineeringDatasets({ from, to, warnings });
  const engineeringTouchedIssueKeys = unique(engineeringDatasets.flatMap((dataset) => {
    const windowOpenedPrs = dataset.lookbackPrs.filter((pr) => isIsoWithinWindow(pr.createdAt, from, to));
    return [
      ...extractJiraKeysFromPRs(windowOpenedPrs),
      ...dataset.commitIssueKeys,
    ];
  }));
  const engineeringIssueDetails = await buildIssueSetDetails(engineeringTouchedIssueKeys).catch((error) => {
    warnings.push(`Engineering Jira issue set unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return {
      originalIssuesByKey: new Map<string, JiraIssue>(),
      displayIssuesByKey: new Map<string, JiraIssue>(),
      displayIssues: [],
      workflowInsights: {},
    } satisfies IssueSetDetails;
  });
  const engineering = buildEngineeringSummary({
    datasets: engineeringDatasets,
    issueDetails: engineeringIssueDetails,
    from,
    to,
  });
  const qa = await buildQaAccumulator({
    from,
    to,
    requestedProjectId: projectId,
    warnings,
  });
  const deliveryDailyMap = buildDailySkeleton(from, to, (date) => ({
    date,
    mergedPrs: engineering.mergedPrDaily.get(date) ?? 0,
    qaResults: qa.qaDaily.get(date)?.qaResults ?? 0,
    defectsLinked: qa.qaDaily.get(date)?.defectsLinked ?? 0,
  }));
  const unionIssues = unique([
    ...engineeringIssueDetails.displayIssues.map((issue) => issue.key),
    ...qa.assignedIssues.map((issue) => issue.key),
  ]).map((key) => (
    engineeringIssueDetails.displayIssues.find((issue) => issue.key === key)
    ?? qa.assignedIssues.find((issue) => issue.key === key)
  )).filter((issue): issue is JiraIssue => !!issue);
  const unionWorkflows: Record<string, JiraIssueWorkflowInsight> = {
    ...engineeringIssueDetails.workflowInsights,
    ...qa.workflowInsights,
  };
  const riskDaily = buildRiskDaily({
    from,
    to,
    lookbackPrs: engineering.lookbackPrs,
    issues: unionIssues,
    workflows: unionWorkflows,
  });
  const reopenedIssueCount = unionIssues.filter((issue) => (unionWorkflows[issue.key]?.reopenedCount ?? 0) > 0).length;
  const qaBounceIssueCount = unionIssues.filter((issue) => (unionWorkflows[issue.key]?.backflowCount ?? 0) > 0).length;
  const riskSummary: ManagementRiskSummary = {
    agingOpenPrCount: engineering.summary.agingOpenPrCount,
    agingActiveIssueCount: riskDaily[riskDaily.length - 1]?.agingActiveIssues ?? 0,
    reopenedIssueCount,
    qaBounceIssueCount,
    reopenedAfterSignoffCount: qa.members.reduce((total, member) => total + member.reopenedAfterSignoffCount, 0),
    rejectedDefectCount: qa.rejectedDefectCount,
    weekendActivityRate: engineering.summary.weekendActivityRate,
  };

  return {
    from,
    to,
    timezone: MANAGEMENT_TIMEZONE,
    engineering: engineering.summary,
    qa: qa.summary,
    risk: riskSummary,
    engineeringMembers: engineering.members,
    qaMembers: qa.members,
    deliveryDaily: Array.from(deliveryDailyMap.values()) as ManagementDeliveryDailyPoint[],
    riskDaily,
    qaProjects: qa.qaProjects,
    metricDefinitions: buildMetricDefinitions(),
    warnings: warnings.length > 0 ? unique(warnings) : undefined,
  };
}
