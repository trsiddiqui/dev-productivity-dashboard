import { eachDayOfInterval, formatISO } from 'date-fns';
import type {
  QaDailyPoint,
  QaGithubAutomationSummary,
  QaMetricDefinition,
  QaStatusBreakdownItem,
  QaSummary,
  TestRailStatusLite,
  TestRailUserLite,
} from './types';
import {
  getGithubPRsWithStats,
  getGithubPullRequestFiles,
  QA_AUTOMATION_BASE_BRANCH,
  QA_AUTOMATION_REPO,
} from './github';
import {
  getTestRailCandidateRuns,
  getTestRailResultsForRun,
  parseTestRailTimespanToSeconds,
  type TestRailRunLite,
} from './testrail';

const QA_METRIC_DEFINITIONS: QaMetricDefinition[] = [
  {
    id: 'results-logged',
    name: 'Results logged',
    category: 'Activity',
    description: 'Execution volume by QA resource within the selected window.',
    derivation: 'Count of TestRail results where created_by equals the selected user.',
  },
  {
    id: 'unique-tests',
    name: 'Unique tests executed',
    category: 'Activity',
    description: 'How broad the tester’s execution spread was versus repeated re-runs.',
    derivation: 'Distinct test_id values across that user’s TestRail results.',
  },
  {
    id: 'pass-rate',
    name: 'Pass rate',
    category: 'Outcomes',
    description: 'Outcome quality signal, balanced against failure and retest pressure.',
    derivation: 'Passed results divided by total results.',
  },
  {
    id: 'failure-pressure',
    name: 'Failure pressure',
    category: 'Risk',
    description: 'Combined failed and retest share, useful for spotting unstable areas or heavy bug discovery.',
    derivation: '(Failed + Retest) results divided by total results.',
  },
  {
    id: 'elapsed-time',
    name: 'Execution time',
    category: 'Efficiency',
    description: 'Reported execution effort captured directly in TestRail.',
    derivation: 'Average and median parsed from the elapsed field on results.',
  },
  {
    id: 'defects-linked',
    name: 'Defects linked',
    category: 'Risk',
    description: 'Signals how often a QA resource linked concrete defects to test evidence.',
    derivation: 'Count of defect IDs parsed from the defects field across results.',
  },
  {
    id: 'comments-logged',
    name: 'Comments logged',
    category: 'Outcomes',
    description: 'How often the tester captured contextual notes or failure details.',
    derivation: 'Count of results with a non-empty comment field.',
  },
  {
    id: 'runs-owned',
    name: 'Runs owned',
    category: 'Activity',
    description: 'Operational ownership of runs, not just execution entries.',
    derivation: 'Runs assigned to or created by the tester, plus completed owned runs.',
  },
  {
    id: 'automation-prs-merged',
    name: 'Automation PRs merged',
    category: 'Delivery',
    description: 'Merged automation PRs to main in aligncommerce/test-engineering1 during the selected window.',
    derivation: 'Count of authored PRs merged to main in the QA automation repo.',
  },
  {
    id: 'test-assets-changed',
    name: 'Test assets changed',
    category: 'Coverage',
    description: 'Changed files under test code, feature files, and TestNG suite definitions.',
    derivation: 'Count of changed files matching src/test/java, src/test/features, cucumber feature roots, or testng*.xml.',
  },
  {
    id: 'median-loc-per-pr',
    name: 'Median LOC per PR',
    category: 'Efficiency',
    description: 'Typical size of automation changes, measured only on test asset files.',
    derivation: 'Median per-PR additions + deletions across matched test asset files.',
  },
  {
    id: 'median-files-per-pr',
    name: 'Median files per PR',
    category: 'Efficiency',
    description: 'Typical number of changed test files per merged automation PR.',
    derivation: 'Median count of matched test asset files changed per PR.',
  },
  {
    id: 'automation-engineering',
    name: 'Automation engineering',
    category: 'Engineering',
    description: 'Framework, CI/config, and shared harness work in the automation repo.',
    derivation: 'Count of changed files under src/main/java plus CI/build/config surfaces like Gradle and .gitlab-ci.yml.',
  },
  {
    id: 'feature-coverage-breadth',
    name: 'Feature coverage breadth',
    category: 'Coverage',
    description: 'Distinct product or test areas touched across automation changes.',
    derivation: 'Distinct area buckets derived from test file and feature file paths in merged PRs.',
  },
];

interface MutableQaSummary extends QaSummary {
  _uniqueTests: Set<number>;
  _runsTouched: Set<number>;
  _activeDays: Set<string>;
  _elapsedSamples: number[];
}

function buildEmptySummary(user: TestRailUserLite): MutableQaSummary {
  return {
    userId: user.id,
    userName: user.name,
    totalResults: 0,
    uniqueTests: 0,
    runsTouched: 0,
    activeDays: 0,
    avgResultsPerActiveDay: null,
    passed: 0,
    failed: 0,
    blocked: 0,
    retest: 0,
    otherStatuses: 0,
    passRate: null,
    failurePressureRate: null,
    totalElapsedSeconds: 0,
    avgElapsedSeconds: null,
    medianElapsedSeconds: null,
    commentsLogged: 0,
    defectsLinked: 0,
    runsAssigned: 0,
    runsCreated: 0,
    completedOwnedRuns: 0,
    github: null,
    _uniqueTests: new Set<number>(),
    _runsTouched: new Set<number>(),
    _activeDays: new Set<string>(),
    _elapsedSamples: [],
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function countDefects(value?: string): number {
  if (!value) return 0;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .length;
}

function statusBucket(status: TestRailStatusLite | undefined): 'passed' | 'failed' | 'blocked' | 'retest' | 'other' {
  const key = `${status?.label ?? ''} ${status?.name ?? ''}`.toLowerCase();
  if (key.includes('pass')) return 'passed';
  if (key.includes('fail')) return 'failed';
  if (key.includes('block')) return 'blocked';
  if (key.includes('retest')) return 'retest';
  return 'other';
}

function finalizeSummary(summary: MutableQaSummary): QaSummary {
  const activeDays = summary._activeDays.size;
  const totalResults = summary.totalResults;

  return {
    userId: summary.userId,
    userName: summary.userName,
    totalResults,
    uniqueTests: summary._uniqueTests.size,
    runsTouched: summary._runsTouched.size,
    activeDays,
    avgResultsPerActiveDay: activeDays > 0 ? totalResults / activeDays : null,
    passed: summary.passed,
    failed: summary.failed,
    blocked: summary.blocked,
    retest: summary.retest,
    otherStatuses: summary.otherStatuses,
    passRate: totalResults > 0 ? summary.passed / totalResults : null,
    failurePressureRate: totalResults > 0 ? (summary.failed + summary.retest) / totalResults : null,
    totalElapsedSeconds: summary.totalElapsedSeconds,
    avgElapsedSeconds: summary._elapsedSamples.length > 0
      ? summary.totalElapsedSeconds / summary._elapsedSamples.length
      : null,
    medianElapsedSeconds: median(summary._elapsedSamples),
    commentsLogged: summary.commentsLogged,
    defectsLinked: summary.defectsLinked,
    runsAssigned: summary.runsAssigned,
    runsCreated: summary.runsCreated,
    completedOwnedRuns: summary.completedOwnedRuns,
    github: summary.github,
  };
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function isTestAssetPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith('src/test/java/')
    || normalized.startsWith('src/test/features/')
    || normalized.startsWith('src/test/java/cucumberTests/features/')
    || /^testng.*\.xml$/i.test(normalized);
}

function isEngineeringPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith('src/main/java/pageFactoryNew/')
    || normalized.startsWith('src/main/java/apiClient/')
    || normalized.startsWith('src/main/java/apiClientConfigs/')
    || normalized.startsWith('src/main/java/apiService/')
    || normalized.startsWith('src/main/java/utils/')
    || normalized.startsWith('src/main/java/TERA/config/')
    || normalized.startsWith('src/main/java/cucumberTests/stepDefinitions/')
    || /^src\/main\/java\/TERA\/[^/]+\/(services|factory)\//.test(normalized)
    || normalized === '.gitlab-ci.yml'
    || normalized === 'build.gradle'
    || normalized === 'settings.gradle'
    || normalized === 'gradle.properties'
    || normalized === 'app.properties'
    || normalized === 'gradlew'
    || normalized === 'gradlew.bat'
    || normalized.startsWith('gradle/');
}

function getFeatureArea(path: string): string | null {
  const normalized = normalizePath(path);

  if (normalized.startsWith('src/test/features/')) {
    const rest = normalized.slice('src/test/features/'.length);
    const area = rest.split('/')[0];
    return area || null;
  }

  if (normalized.startsWith('src/test/java/cucumberTests/features/')) {
    const rest = normalized.slice('src/test/java/cucumberTests/features/'.length);
    const area = rest.split('/')[0];
    return area || null;
  }

  if (normalized.startsWith('src/test/java/TERA/')) {
    const parts = normalized.slice('src/test/java/TERA/'.length).split('/').filter(Boolean);
    if (parts.length === 0) return null;
    if ((parts[0] === 'api' || parts[0] === 'contract') && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }

  return null;
}

async function computeGithubAutomationSummary(params: {
  login: string;
  from: string;
  to: string;
}): Promise<QaGithubAutomationSummary> {
  const prs = await getGithubPRsWithStats({
    login: params.login,
    from: params.from,
    to: params.to,
    repo: QA_AUTOMATION_REPO,
    baseBranch: QA_AUTOMATION_BASE_BRANCH,
    mergedOnly: true,
    dateField: 'merged',
  });

  if (prs.length === 0) {
    return {
      login: params.login,
      mergedPrs: 0,
      testAssetFilesChanged: 0,
      totalLocChanged: 0,
      medianLocChangedPerPr: null,
      medianFilesChangedPerPr: null,
      engineeringFilesChanged: 0,
      featureCoverageBreadth: 0,
    };
  }

  const filesByPr = await mapWithConcurrency(prs, 5, (pr) => getGithubPullRequestFiles({
    owner: pr.repository.owner,
    repo: pr.repository.name,
    number: pr.number,
  }));

  let testAssetFilesChanged = 0;
  let totalLocChanged = 0;
  let engineeringFilesChanged = 0;
  const featureAreas = new Set<string>();
  const locPerPr: number[] = [];
  const filesPerPr: number[] = [];

  filesByPr.forEach((files) => {
    let prLocChanged = 0;
    let prTestFilesChanged = 0;

    for (const file of files) {
      const filePath = file.filename;
      if (isTestAssetPath(filePath)) {
        const locChanged = file.additions + file.deletions;
        prLocChanged += locChanged;
        prTestFilesChanged += 1;
        testAssetFilesChanged += 1;
        totalLocChanged += locChanged;

        const featureArea = getFeatureArea(filePath);
        if (featureArea) featureAreas.add(featureArea);
      }

      if (isEngineeringPath(filePath)) {
        engineeringFilesChanged += 1;
      }
    }

    locPerPr.push(prLocChanged);
    filesPerPr.push(prTestFilesChanged);
  });

  return {
    login: params.login,
    mergedPrs: prs.length,
    testAssetFilesChanged,
    totalLocChanged,
    medianLocChangedPerPr: median(locPerPr),
    medianFilesChangedPerPr: median(filesPerPr),
    engineeringFilesChanged,
    featureCoverageBreadth: featureAreas.size,
  };
}

function buildDailySeries(from: string, to: string): QaDailyPoint[] {
  return eachDayOfInterval({ start: new Date(`${from}T00:00:00Z`), end: new Date(`${to}T00:00:00Z`) })
    .map((date) => ({
      date: formatISO(date, { representation: 'date' }),
      leftResults: 0,
      rightResults: 0,
      leftPassed: 0,
      rightPassed: 0,
      leftFailed: 0,
      rightFailed: 0,
    }));
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

export async function computeQaComparison(params: {
  projectId: number;
  from: string;
  to: string;
  leftUser: TestRailUserLite;
  rightUser: TestRailUserLite;
  statuses: TestRailStatusLite[];
  leftGithubLogin?: string | null;
  rightGithubLogin?: string | null;
}): Promise<{
  left: QaSummary;
  right: QaSummary;
  daily: QaDailyPoint[];
  statusBreakdown: QaStatusBreakdownItem[];
  metricDefinitions: QaMetricDefinition[];
  warnings?: string[];
}> {
  const { projectId, from, to, leftUser, rightUser, statuses, leftGithubLogin, rightGithubLogin } = params;
  const fromTimestamp = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const toTimestamp = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  const warnings: string[] = [];
  const candidateRuns = await getTestRailCandidateRuns({ projectId, fromTimestamp, toTimestamp });

  const left = buildEmptySummary(leftUser);
  const right = buildEmptySummary(rightUser);
  const summaryByUserId = new Map<number, MutableQaSummary>([
    [left.userId, left],
    [right.userId, right],
  ]);
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const daily = buildDailySeries(from, to);
  const dailyByDate = new Map(daily.map((point) => [point.date, point]));
  const statusBreakdownMap = new Map<number, QaStatusBreakdownItem>();

  for (const run of candidateRuns) {
    for (const summary of summaryByUserId.values()) {
      if (run.assignedToId === summary.userId) summary.runsAssigned += 1;
      if (run.createdBy === summary.userId) summary.runsCreated += 1;
      if (run.completedOn && (run.assignedToId === summary.userId || run.createdBy === summary.userId)) {
        summary.completedOwnedRuns += 1;
      }
    }
  }

  const resultsByRun = await mapWithConcurrency(candidateRuns, 5, (run: TestRailRunLite) => getTestRailResultsForRun({
    runId: run.id,
    fromTimestamp,
    toTimestamp,
    createdByIds: [left.userId, right.userId],
  }));

  candidateRuns.forEach((run, index) => {
    for (const result of resultsByRun[index]) {
      const summary = summaryByUserId.get(result.createdBy);
      if (!summary) continue;

      summary.totalResults += 1;
      summary._uniqueTests.add(result.testId);
      summary._runsTouched.add(run.id);

      const date = formatISO(new Date(result.createdOn * 1000), { representation: 'date' });
      summary._activeDays.add(date);
      const day = dailyByDate.get(date);

      const status = statusById.get(result.statusId);
      const bucket = statusBucket(status);
      if (bucket === 'passed') summary.passed += 1;
      if (bucket === 'failed') summary.failed += 1;
      if (bucket === 'blocked') summary.blocked += 1;
      if (bucket === 'retest') summary.retest += 1;
      if (bucket === 'other') summary.otherStatuses += 1;

      if (day) {
        if (summary.userId === left.userId) {
          day.leftResults += 1;
          if (bucket === 'passed') day.leftPassed += 1;
          if (bucket === 'failed') day.leftFailed += 1;
        } else {
          day.rightResults += 1;
          if (bucket === 'passed') day.rightPassed += 1;
          if (bucket === 'failed') day.rightFailed += 1;
        }
      }

      const elapsedSeconds = parseTestRailTimespanToSeconds(result.elapsed);
      if (elapsedSeconds !== null) {
        summary.totalElapsedSeconds += elapsedSeconds;
        summary._elapsedSamples.push(elapsedSeconds);
      }

      if (result.comment?.trim()) summary.commentsLogged += 1;
      summary.defectsLinked += countDefects(result.defects);

      const statusRow = statusBreakdownMap.get(result.statusId) ?? {
        statusId: result.statusId,
        statusLabel: status?.label ?? `Status ${result.statusId}`,
        leftCount: 0,
        rightCount: 0,
      };
      if (summary.userId === left.userId) statusRow.leftCount += 1;
      else statusRow.rightCount += 1;
      statusBreakdownMap.set(result.statusId, statusRow);
    }
  });

  const statusBreakdown = Array.from(statusBreakdownMap.values())
    .sort((leftItem, rightItem) => (rightItem.leftCount + rightItem.rightCount) - (leftItem.leftCount + leftItem.rightCount));

  if (!leftGithubLogin || !rightGithubLogin) {
    warnings.push('Select the corresponding GitHub users to unlock automation metrics from aligncommerce/test-engineering1.');
  }

  const [leftGithubSummary, rightGithubSummary] = await Promise.all([
    leftGithubLogin
      ? computeGithubAutomationSummary({ login: leftGithubLogin, from, to })
      : Promise.resolve(null),
    rightGithubLogin
      ? computeGithubAutomationSummary({ login: rightGithubLogin, from, to })
      : Promise.resolve(null),
  ]);

  left.github = leftGithubSummary;
  right.github = rightGithubSummary;

  return {
    left: finalizeSummary(left),
    right: finalizeSummary(right),
    daily,
    statusBreakdown,
    metricDefinitions: QA_METRIC_DEFINITIONS,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
