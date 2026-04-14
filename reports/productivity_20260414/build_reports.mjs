import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import PptxGenJS from 'pptxgenjs';
import ExcelJS from 'exceljs';

const reportScriptRoot = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(reportScriptRoot, '..', '..');
const outputBaseRoot = process.env.REPORT_OUTPUT_BASE
  ? path.resolve(repoRoot, process.env.REPORT_OUTPUT_BASE)
  : path.resolve(repoRoot, 'reports', 'productivity_runs');
const runId = process.env.REPORT_RUN_ID || `productivity_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const outputRoot = path.resolve(outputBaseRoot, runId, 'artifacts');
const dataRoot = path.join(outputRoot, 'data');
const decksRoot = path.join(outputRoot, 'decks');
const devDeckRoot = path.join(decksRoot, 'developers');
const qaDeckRoot = path.join(decksRoot, 'qas');
const workbookRoot = path.join(outputRoot, 'workbooks');
const archiveRoot = path.join(outputRoot, 'archives');
const manifestPath = path.join(outputRoot, 'index.html');
const latestRunMetadataPath = path.join(outputBaseRoot, 'latest.json');

const BASE_URL = process.env.REPORT_BASE_URL || 'http://localhost:3000';
const FETCH_TIMEOUT_MS = Number(process.env.REPORT_FETCH_TIMEOUT_MS || 300000);
const PERSON_CONCURRENCY = Number(process.env.REPORT_PERSON_CONCURRENCY || 2);
const MONTH_CONCURRENCY = Number(process.env.REPORT_MONTH_CONCURRENCY || 2);
const REPORT_MONTH_COUNT = Number(process.env.REPORT_MONTH_COUNT || 6);
const REPORT_END_MONTH = process.env.REPORT_END_MONTH || '';

function monthRange(year, monthIndex) {
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const normalizedYear = start.getUTCFullYear();
  const normalizedMonthIndex = start.getUTCMonth();
  const end = new Date(Date.UTC(normalizedYear, normalizedMonthIndex + 1, 0));
  const mm = String(normalizedMonthIndex + 1).padStart(2, '0');
  return {
    key: `${normalizedYear}-${mm}`,
    label: start.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    from: `${normalizedYear}-${mm}-01`,
    to: `${normalizedYear}-${mm}-${String(end.getUTCDate()).padStart(2, '0')}`,
    qaProjectName: `VeemTestEngineeringV${String(normalizedYear).slice(-2)}`,
  };
}

function deriveMonths(count, endMonthToken) {
  if (count < 1) throw new Error('REPORT_MONTH_COUNT must be at least 1.');

  let endYear;
  let endMonthIndex;
  if (endMonthToken) {
    const match = /^(\d{4})-(\d{2})$/.exec(endMonthToken.trim());
    if (!match) throw new Error(`Invalid REPORT_END_MONTH "${endMonthToken}". Use YYYY-MM.`);
    endYear = Number(match[1]);
    endMonthIndex = Number(match[2]) - 1;
  } else {
    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    endYear = currentMonthStart.getUTCFullYear();
    endMonthIndex = currentMonthStart.getUTCMonth() - 1;
  }

  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    months.push(monthRange(endYear, endMonthIndex - offset));
  }
  return months;
}

const MONTHS = deriveMonths(REPORT_MONTH_COUNT, REPORT_END_MONTH);
const OVERALL_FROM = MONTHS[0].from;
const OVERALL_TO = MONTHS[MONTHS.length - 1].to;
const WINDOW_MONTH_COUNT_LABEL = `${MONTHS.length}-month`;
const WINDOW_LABEL = `${MONTHS[0].label} to ${MONTHS[MONTHS.length - 1].label}`;

const COLORS = {
  bg: 'F6F8FC',
  panel: 'FFFFFF',
  softPanel: 'EEF4FF',
  border: 'D8E2F0',
  text: '16213B',
  muted: '61708A',
  blue: '2D6CDF',
  blueSoft: 'DCE7FF',
  orange: 'F59E0B',
  orangeSoft: 'FFF1D6',
  green: '129A74',
  greenSoft: 'D9F4EB',
  red: 'D64545',
  redSoft: 'FBE0E0',
  purple: '7C4DFF',
  slate: 'CBD5E1',
};

const SLIDE = {
  w: 13.333,
  h: 7.5,
  marginX: 0.45,
  marginY: 0.32,
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildLatestLandingPage(metadata) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Latest Productivity Report Run</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 32px; background: #f6f8fc; color: #16213b; }
h1 { margin-top: 0; }
a { color: #2d6cdf; text-decoration: none; font-weight: 600; }
.card { background: #fff; border: 1px solid #d8e2f0; border-radius: 16px; padding: 20px 22px; max-width: 720px; }
.meta { color: #61708a; margin-bottom: 18px; }
</style>
</head>
<body>
<div class="card">
  <h1>Latest Productivity Report Run</h1>
  <p class="meta">Run ID: ${metadata.runId}</p>
  <p><strong>Window:</strong> ${metadata.overallFrom} to ${metadata.overallTo}</p>
  <p><strong>Months:</strong> ${metadata.months.map((month) => month.label).join(', ')}</p>
  <p><a href="./${metadata.runId}/artifacts/index.html">Open latest artifact manifest</a></p>
  <p><a href="./latest.json">Open latest metadata JSON</a></p>
</div>
</body>
</html>`;
}

function zipDirectory(sourceDir, outZipPath) {
  const result = spawnSync('zip', ['-qr', outZipPath, path.basename(sourceDir)], {
    cwd: path.dirname(sourceDir),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to create zip ${outZipPath}: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadEnv(filePath) {
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1);
  }
  return out;
}

function sanitizeFileName(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function logProgress(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

function mergeRoster(prefix, type) {
  const files = fs.readdirSync(path.join(repoRoot, 'testing', 'data'))
    .filter((file) => file === `${prefix}.json` || file.startsWith(`${prefix}-`))
    .sort((a, b) => {
      if (a === `${prefix}.json`) return -1;
      if (b === `${prefix}.json`) return 1;
      return a.localeCompare(b);
    });

  const members = [];
  const comparisons = [];
  const peerByAlias = new Map();
  let defaultProject = null;

  for (const file of files) {
    const fullPath = path.join(repoRoot, 'testing', 'data', file);
    const payload = readJson(fullPath);
    const team = file.includes('-pc') ? 'PC' : 'PE';
    for (const member of payload.members ?? []) {
      if (!members.some((entry) => entry.alias === member.alias)) {
        members.push({ ...member, team, type });
      }
    }
    for (const comparison of payload.defaultComparisons ?? []) {
      comparisons.push({ ...comparison, team });
      if (!peerByAlias.has(comparison.leftQaAlias)) peerByAlias.set(comparison.leftQaAlias, comparison.rightQaAlias);
      if (!peerByAlias.has(comparison.rightQaAlias)) peerByAlias.set(comparison.rightQaAlias, comparison.leftQaAlias);
    }
    if (!defaultProject && payload.defaultProject) defaultProject = payload.defaultProject;
  }

  return { members, comparisons, peerByAlias, defaultProject };
}

function buildCookies(env) {
  const account = (env.USER_ACCOUNTS ?? 'a:b').split(',')[0];
  const [username, ...passwordParts] = account.split(':');
  const password = passwordParts.join(':');
  const secret = env.AUTH_SECRET || 'dev-change-me';
  const authToken = `${username}|${crypto.createHmac('sha256', secret).update(username).digest('hex')}`;
  const runtimeSettings = {
    username,
    githubToken: env.GITHUB_TOKEN ?? '',
    githubOrg: env.GITHUB_ORG ?? '',
    jiraBaseUrl: env.JIRA_BASE_URL ?? '',
    jiraEmail: env.JIRA_EMAIL ?? '',
    jiraToken: env.JIRA_API_TOKEN ?? '',
    jiraStoryPointsField: env.JIRA_STORY_POINTS_FIELD ?? '',
    jiraQAAssigneeField: env.JIRA_QA_ASSIGNEE_FIELD ?? 'customfield_11370',
    testRailBaseUrl: env.TESTRAIL_BASE_URL ?? '',
    testRailEmail: env.TESTRAIL_EMAIL ?? '',
    testRailToken: env.TESTRAIL_API_TOKEN ?? '',
  };
  const runtimeCookie = encodeURIComponent(JSON.stringify(runtimeSettings));
  return {
    username,
    password,
    header: `dpd_auth=${encodeURIComponent(authToken)}; dpd_runtime_settings=${runtimeCookie}`,
  };
}

async function fetchJson(urlPath, params, cookieHeader) {
  const url = new URL(urlPath, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    throw new Error(`${url.pathname}${url.search} -> ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`${url.pathname}${url.search} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}

function normalizedJiraBase(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return baseUrl.replace(/\/(jira|wiki|confluence)\/?$/i, '');
  }
}

async function runJiraSearch(params) {
  const { base, auth, jql, fields, maxResults = 100 } = params;
  const issues = [];
  let nextPageToken;

  do {
    const response = await fetch(`${base}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql,
        fields,
        fieldsByKeys: true,
        maxResults,
        nextPageToken,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Jira search failed for ${jql}: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    issues.push(...(payload.issues ?? []));
    nextPageToken = payload.isLast ? undefined : payload.nextPageToken;
  } while (nextPageToken);

  return issues;
}

function isJiraSubtask(issueType) {
  if (!issueType || typeof issueType !== 'object') return false;
  const typed = issueType;
  return typed.subtask === true || String(typed.name ?? '').trim().toLowerCase() === 'sub-task';
}

async function fetchQaJiraAssignmentSummary(params) {
  const { env, from, to, jiraUser } = params;
  if (!jiraUser?.accountId || !env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) {
    return {
      jiraDisplayName: jiraUser?.displayName ?? null,
      jiraAssignedTicketCount: null,
      jiraAssignedStoryPoints: null,
    };
  }

  const base = normalizedJiraBase(env.JIRA_BASE_URL);
  const auth = 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  const storyPointsField = env.JIRA_STORY_POINTS_FIELD || 'customfield_11125';
  const qaFieldId = (env.JIRA_QA_ASSIGNEE_FIELD || 'customfield_11370').replace('customfield_', '');
  const qaFieldJqlName = `cf[${qaFieldId}]`;
  const fields = [
    'summary',
    'status',
    'updated',
    'created',
    'resolutiondate',
    'issuetype',
    'parent',
    storyPointsField,
  ];

  const rawIssues = await runJiraSearch({
    base,
    auth,
    jql: `updated >= "${from}" AND updated <= "${to}" AND ${qaFieldJqlName} = "${jiraUser.accountId}"`,
    fields,
  });

  const parentKeys = new Set();
  const issues = rawIssues.map((issue) => {
    const parentKey = issue.fields?.parent?.key;
    const isSubtask = isJiraSubtask(issue.fields?.issuetype);
    if (isSubtask && parentKey) parentKeys.add(parentKey);
    return {
      key: issue.key,
      summary: issue.fields?.summary ?? '',
      storyPoints: typeof issue.fields?.[storyPointsField] === 'number' ? issue.fields[storyPointsField] : undefined,
      isSubtask,
      parentKey,
    };
  });

  const parentByKey = new Map();
  if (parentKeys.size > 0) {
    const parentIssues = await runJiraSearch({
      base,
      auth,
      jql: `key in (${Array.from(parentKeys).map((key) => `"${key}"`).join(',')})`,
      fields,
    });
    for (const issue of parentIssues) {
      parentByKey.set(issue.key, {
        key: issue.key,
        summary: issue.fields?.summary ?? '',
        storyPoints: typeof issue.fields?.[storyPointsField] === 'number' ? issue.fields[storyPointsField] : undefined,
      });
    }
  }

  const canonical = new Map();
  for (const issue of issues) {
    if (issue.isSubtask && issue.parentKey && parentByKey.has(issue.parentKey)) {
      canonical.set(issue.parentKey, parentByKey.get(issue.parentKey));
      continue;
    }
    canonical.set(issue.key, issue);
  }

  const canonicalIssues = Array.from(canonical.values());
  return {
    jiraDisplayName: jiraUser.displayName,
    jiraAssignedTicketCount: canonicalIssues.length,
    jiraAssignedStoryPoints: canonicalIssues.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0),
  };
}

async function refreshQaJiraMetrics(qaPeople, jiraByEmail, jiraByName, env) {
  return mapLimit(qaPeople, PERSON_CONCURRENCY, async (person) => {
    const jiraUser = jiraByEmail.get(String(person.member.email).toLowerCase())
      ?? jiraByName.get(String(person.member.name).toLowerCase());
    if (!jiraUser) {
      person.overall = {
        ...person.overall,
        jiraDisplayName: null,
        assignedTicketCount: null,
        assignedStoryPoints: null,
      };
      person.monthly = person.monthly.map((month) => ({
        ...month,
        jiraDisplayName: null,
        jiraAssignedTicketCount: null,
        jiraAssignedStoryPoints: null,
      }));
      return person;
    }

    const monthlyJira = await mapLimit(person.monthly, MONTH_CONCURRENCY, async (month) => fetchQaJiraAssignmentSummary({
      env,
      from: month.from,
      to: month.to,
      jiraUser,
    }));
    person.monthly = person.monthly.map((month, index) => ({
      ...month,
      ...monthlyJira[index],
    }));

    const overallJira = await fetchQaJiraAssignmentSummary({
      env,
      from: OVERALL_FROM,
      to: OVERALL_TO,
      jiraUser,
    });
    person.overall = {
      ...person.overall,
      jiraDisplayName: overallJira.jiraDisplayName,
      assignedTicketCount: overallJira.jiraAssignedTicketCount,
      assignedStoryPoints: overallJira.jiraAssignedStoryPoints,
    };
    person.jiraUser = jiraUser;
    return person;
  });
}

function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function fmtPct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const normalized = Math.abs(value) > 1 ? value : value * 100;
  return `${fmtNumber(normalized, digits)}%`;
}

function fmtHours(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${fmtNumber(value, digits)}h`;
}

function fmtDays(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${fmtNumber(value, digits)}d`;
}

function mean(values) {
  const filtered = values.filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function median(values) {
  const filtered = values.filter((value) => value !== null && value !== undefined && Number.isFinite(value)).sort((a, b) => a - b);
  if (filtered.length === 0) return null;
  const mid = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[mid - 1] + filtered[mid]) / 2 : filtered[mid];
}

function percentageDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

function weekday(dateText) {
  const day = new Date(`${dateText}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function countWeekdaysWithoutActiveJira(wip) {
  return wip.filter((item) => weekday(item.date) && item.activeIssues === 0).length;
}

function longestWeekdayInactiveGap(wip) {
  let best = 0;
  let current = 0;
  for (const item of wip) {
    if (!weekday(item.date)) continue;
    if (item.activeIssues === 0) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function locPerStoryPoint(locChanged, storyPoints) {
  if (!storyPoints) return null;
  return locChanged / storyPoints;
}

function normalizeDevMonth(raw, month) {
  return {
    month: month.key,
    monthLabel: month.label,
    from: raw.from,
    to: raw.to,
    totalPRs: raw.kpis.totalPRs,
    totalAdditions: raw.kpis.totalAdditions,
    totalDeletions: raw.kpis.totalDeletions,
    totalLocChanged: raw.kpis.totalLocChanged,
    touchedTicketStoryPoints: raw.kpis.touchedTicketStoryPoints,
    locPerStoryPoint: locPerStoryPoint(raw.kpis.totalLocChanged, raw.kpis.touchedTicketStoryPoints),
    activeDays: raw.kpis.activeDays,
    activeDayRate: raw.kpis.activeDayRate,
    medianLocPerPR: raw.kpis.medianLocPerPR,
    avgLocPerPR: raw.kpis.avgLocPerPR,
    avgLocPerActiveDay: raw.kpis.avgLocPerActiveDay,
    longestIdleGapDays: raw.kpis.longestIdleGapDays,
    burstiestDayShare: raw.kpis.burstiestDayShare,
    avgDaysBetweenPRs: raw.kpis.avgDaysBetweenPRs,
    givenReviews: raw.reviews.given.totalReviews,
    commentsGiven: raw.reviews.given.reviewComments,
    reviewedPRs: raw.reviews.given.reviewedPRs,
    approvalsGiven: raw.reviews.given.approvals,
    changeRequestsGiven: raw.reviews.given.changesRequested,
    commentReviewsGiven: raw.reviews.given.comments,
    receivedReviews: raw.reviews.received.totalReviews,
    commentsReceived: raw.reviews.received.reviewComments,
    reviewedOwnPRs: raw.reviews.received.reviewedPRs,
    approvalsReceived: raw.reviews.received.approvals,
    changeRequestsReceived: raw.reviews.received.changesRequested,
    commentReviewsReceived: raw.reviews.received.comments,
    prCycleSampleSize: raw.prCycle.sampleSize,
    medianFirstCommitToMergeHours: raw.prCycle.medianFirstCommitToMergeHours,
    medianCodingHours: raw.prCycle.medianCodingHours,
    medianLastCommitToReviewHours: raw.prCycle.medianLastCommitToReviewHours,
    medianReviewToMergeHours: raw.prCycle.medianReviewToMergeHours,
    jiraCodingSampleSize: raw.jiraPrTiming.codingSampleSize,
    avgCodingHours: raw.jiraPrTiming.avgCodingHours,
    jiraCycleSampleSize: raw.jiraPrTiming.cycleSampleSize,
    avgJiraCycleHours: raw.jiraPrTiming.avgCycleTimeHours,
    issueCycleSampleSize: raw.issueCycle.sampleSize,
    issueCycleCompletedCount: raw.issueCycle.completedCount,
    medianIssueCycleHours: raw.issueCycle.medianCycleTimeHours,
    avgIssueCycleHours: raw.issueCycle.avgCycleTimeHours,
    weekdaysWithoutActiveJira: countWeekdaysWithoutActiveJira(raw.wip),
    longestNoActiveJiraGap: longestWeekdayInactiveGap(raw.wip),
    warnings: raw.warnings ?? [],
  };
}

function normalizeQaMonth(rawCompare, month, projectName) {
  const left = rawCompare.left;
  return {
    month: month.key,
    monthLabel: month.label,
    from: rawCompare.from,
    to: rawCompare.to,
    projectName,
    totalResults: left.totalResults,
    uniqueTests: left.uniqueTests,
    runsTouched: left.runsTouched,
    activeDays: left.activeDays,
    avgResultsPerActiveDay: left.avgResultsPerActiveDay,
    passed: left.passed,
    failed: left.failed,
    blocked: left.blocked,
    retest: left.retest,
    otherStatuses: left.otherStatuses,
    passRate: left.passRate,
    failurePressureRate: left.failurePressureRate,
    totalElapsedSeconds: left.totalElapsedSeconds,
    avgElapsedSeconds: left.avgElapsedSeconds,
    medianElapsedSeconds: left.medianElapsedSeconds,
    commentsLogged: left.commentsLogged,
    defectsLinked: left.defectsLinked,
    runsAssigned: left.runsAssigned,
    runsCreated: left.runsCreated,
    completedOwnedRuns: left.completedOwnedRuns,
    jiraDisplayName: left.jira?.displayName ?? null,
    jiraAssignedTicketCount: left.jira?.assignedTicketCount ?? null,
    jiraAssignedStoryPoints: left.jira?.assignedStoryPoints ?? null,
    githubMergedPrs: left.github?.mergedPrs ?? null,
    githubTestAssetFilesChanged: left.github?.testAssetFilesChanged ?? null,
    githubTotalLocChanged: left.github?.totalLocChanged ?? null,
    githubMedianLocChangedPerPr: left.github?.medianLocChangedPerPr ?? null,
    githubMedianFilesChangedPerPr: left.github?.medianFilesChangedPerPr ?? null,
    githubEngineeringFilesChanged: left.github?.engineeringFilesChanged ?? null,
    githubFeatureCoverageBreadth: left.github?.featureCoverageBreadth ?? null,
    warnings: rawCompare.warnings ?? [],
  };
}

function overallQaFromMonthly(member, monthly, overallSummary) {
  const totalResults = sum(monthly.map((item) => item.totalResults));
  const passed = sum(monthly.map((item) => item.passed));
  const failed = sum(monthly.map((item) => item.failed));
  const retest = sum(monthly.map((item) => item.retest));
  const blocked = sum(monthly.map((item) => item.blocked));
  const commentsLogged = sum(monthly.map((item) => item.commentsLogged));
  const defectsLinked = sum(monthly.map((item) => item.defectsLinked));
  const activeDaysTotal = sum(monthly.map((item) => item.activeDays));

  return {
    name: member.name,
    team: member.team,
    totalResults,
    passRate: totalResults > 0 ? passed / totalResults : null,
    failurePressureRate: totalResults > 0 ? (failed + retest) / totalResults : null,
    avgActiveDays: mean(monthly.map((item) => item.activeDays)),
    avgUniqueTests: mean(monthly.map((item) => item.uniqueTests)),
    avgResultsPerActiveDay: activeDaysTotal > 0 ? totalResults / activeDaysTotal : null,
    commentsLogged,
    defectsLinked,
    runsTouched: sum(monthly.map((item) => item.runsTouched)),
    jiraDisplayName: overallSummary.jira?.displayName ?? null,
    assignedTicketCount: overallSummary.jira?.assignedTicketCount ?? null,
    assignedStoryPoints: overallSummary.jira?.assignedStoryPoints ?? null,
    passed,
    failed,
    retest,
    blocked,
    github: overallSummary.github ?? null,
  };
}

function summarizeDevOverall(member, overallRaw, monthly) {
  return {
    name: member.name,
    team: member.team,
    totalLocChanged: overallRaw.kpis.totalLocChanged,
    locPerStoryPoint: locPerStoryPoint(overallRaw.kpis.totalLocChanged, overallRaw.kpis.touchedTicketStoryPoints),
    touchedTicketStoryPoints: overallRaw.kpis.touchedTicketStoryPoints,
    avgMonthlyActiveDays: mean(monthly.map((item) => item.activeDays)),
    totalPRs: overallRaw.kpis.totalPRs,
    activeDayRate: overallRaw.kpis.activeDayRate,
    medianLocPerPR: overallRaw.kpis.medianLocPerPR,
    longestIdleGapDays: overallRaw.kpis.longestIdleGapDays,
    burstiestDayShare: overallRaw.kpis.burstiestDayShare,
    avgDaysBetweenPRs: overallRaw.kpis.avgDaysBetweenPRs,
    reviewsCompleted: overallRaw.reviews.given.totalReviews,
    commentsGiven: overallRaw.reviews.given.reviewComments,
    reviewsReceived: overallRaw.reviews.received.totalReviews,
    commentsReceived: overallRaw.reviews.received.reviewComments,
    avgIssueCycleDays: overallRaw.issueCycle.avgCycleTimeHours !== null && overallRaw.issueCycle.avgCycleTimeHours !== undefined
      ? overallRaw.issueCycle.avgCycleTimeHours / 24
      : null,
    medianIssueCycleDays: overallRaw.issueCycle.medianCycleTimeHours !== null && overallRaw.issueCycle.medianCycleTimeHours !== undefined
      ? overallRaw.issueCycle.medianCycleTimeHours / 24
      : null,
    avgCodingHours: overallRaw.jiraPrTiming.avgCodingHours,
    avgCycleTimeHours: overallRaw.jiraPrTiming.avgCycleTimeHours,
  };
}

function benchmarkMedian(items, key) {
  return median(items.map((item) => item[key]).filter((value) => value !== null && value !== undefined));
}

function teamBenchmarks(devSummaries, qaSummaries) {
  return {
    dev: {
      totalLocChanged: benchmarkMedian(devSummaries, 'totalLocChanged'),
      locPerStoryPoint: benchmarkMedian(devSummaries, 'locPerStoryPoint'),
      avgMonthlyActiveDays: benchmarkMedian(devSummaries, 'avgMonthlyActiveDays'),
      medianLocPerPR: benchmarkMedian(devSummaries, 'medianLocPerPR'),
      longestIdleGapDays: benchmarkMedian(devSummaries, 'longestIdleGapDays'),
      commentsReceivedPerReview: median(devSummaries.map((item) => item.reviewsReceived ? item.commentsReceived / item.reviewsReceived : null)),
      reviewsCompleted: benchmarkMedian(devSummaries, 'reviewsCompleted'),
    },
    qa: {
      totalResults: benchmarkMedian(qaSummaries, 'totalResults'),
      passRate: benchmarkMedian(qaSummaries, 'passRate'),
      avgActiveDays: benchmarkMedian(qaSummaries, 'avgActiveDays'),
      avgResultsPerActiveDay: benchmarkMedian(qaSummaries, 'avgResultsPerActiveDay'),
      assignedTicketCount: benchmarkMedian(qaSummaries, 'assignedTicketCount'),
      assignedStoryPoints: benchmarkMedian(qaSummaries, 'assignedStoryPoints'),
      defectsLinked: benchmarkMedian(qaSummaries, 'defectsLinked'),
      automationPrs: median(qaSummaries.map((item) => item.github?.mergedPrs ?? null)),
      testAssets: median(qaSummaries.map((item) => item.github?.testAssetFilesChanged ?? null)),
      featureBreadth: median(qaSummaries.map((item) => item.github?.featureCoverageBreadth ?? null)),
      failurePressureRate: benchmarkMedian(qaSummaries, 'failurePressureRate'),
    },
  };
}

function rankLabel(value, medianValue, higherIsBetter = true) {
  if (value === null || medianValue === null || medianValue === 0 || value === undefined) return 'No peer baseline';
  const delta = (value - medianValue) / medianValue;
  if (Math.abs(delta) < 0.08) return `Near team median (${fmtNumber(medianValue, 1)})`;
  if (delta > 0) {
    return higherIsBetter
      ? `${fmtPct(delta, 0)} above team median`
      : `${fmtPct(delta, 0)} above team median`;
  }
  return higherIsBetter
    ? `${fmtPct(Math.abs(delta), 0)} below team median`
    : `${fmtPct(Math.abs(delta), 0)} below team median`;
}

function trendWindow(monthly, key) {
  const first = sum(monthly.slice(0, 3).map((item) => item[key] ?? 0));
  const last = sum(monthly.slice(3).map((item) => item[key] ?? 0));
  return { first, last, delta: percentageDelta(last, first) };
}

function buildDeveloperNarrative(person, benchmarks) {
  const monthly = person.monthly;
  const overall = person.overall;
  const locTrend = trendWindow(monthly, 'totalLocChanged');
  const activeTrend = trendWindow(monthly, 'activeDays');
  const commentsPerReview = overall.reviewsReceived ? overall.commentsReceived / overall.reviewsReceived : null;
  const teamCommentsPerReview = benchmarks.commentsReceivedPerReview;

  const insights = [];
  insights.push(
    `${fmtNumber(overall.totalLocChanged)} LOC shipped across ${fmtNumber(overall.totalPRs)} PRs and ${fmtNumber(overall.touchedTicketStoryPoints, 1)} touched story points.`
  );
  insights.push(
    locTrend.delta === null
      ? `Last-three-month output is not comparable because the first half of the window had no shipped LOC baseline.`
      : `Last-three-month shipped LOC ${locTrend.delta >= 0 ? 'rose' : 'fell'} ${fmtPct(Math.abs(locTrend.delta), 0)} versus the first three months.`
  );
  insights.push(
    `${fmtNumber(overall.reviewsReceived)} received reviews led to ${fmtNumber(overall.commentsReceived)} threaded comments, while this developer completed ${fmtNumber(overall.reviewsCompleted)} reviews and left ${fmtNumber(overall.commentsGiven)} threaded comments.`
  );

  const focusAreas = [];
  if ((overall.avgMonthlyActiveDays ?? 0) < (benchmarks.avgMonthlyActiveDays ?? 0) || (activeTrend.delta ?? 0) < -0.1) {
    focusAreas.push(`Consistency: average active days are ${fmtNumber(overall.avgMonthlyActiveDays, 1)} per month versus a team median of ${fmtNumber(benchmarks.avgMonthlyActiveDays, 1)}.`);
  }
  if ((overall.longestIdleGapDays ?? 0) > (benchmarks.longestIdleGapDays ?? 0)) {
    focusAreas.push(`Flow: the longest idle gap reached ${fmtNumber(overall.longestIdleGapDays, 1)} days, above the team median of ${fmtNumber(benchmarks.longestIdleGapDays, 1)}.`);
  }
  if ((overall.medianLocPerPR ?? 0) > (benchmarks.medianLocPerPR ?? 0) * 1.15 || (overall.burstiestDayShare ?? 0) > 0.55) {
    focusAreas.push(`PR shape: median PR size is ${fmtNumber(overall.medianLocPerPR, 1)} LOC and ${fmtPct(overall.burstiestDayShare, 0)} of all LOC landed on one day, so work is batching up.`);
  }
  if ((commentsPerReview ?? 0) > (teamCommentsPerReview ?? 0) * 1.15) {
    focusAreas.push(`PR cleanliness: comments received per review are ${fmtNumber(commentsPerReview, 2)} versus a team median of ${fmtNumber(teamCommentsPerReview, 2)}.`);
  }
  if ((overall.locPerStoryPoint ?? 0) < (benchmarks.locPerStoryPoint ?? 0) * 0.85) {
    focusAreas.push(`Ticket throughput: LOC per story point is ${fmtNumber(overall.locPerStoryPoint, 1)} versus a team median of ${fmtNumber(benchmarks.locPerStoryPoint, 1)}.`);
  }

  while (focusAreas.length < 3) {
    focusAreas.push('Maintain throughput while using AI to reduce repetitive scaffolding, test writing, and pre-PR cleanup.');
  }

  const strategies = [
    'Start each ticket with an agent-generated execution plan, test checklist, and first shippable PR slice.',
    'Run AI self-review before every PR to catch missing tests, simplify large diffs, and reduce review comments.',
    'Use agentic scaffolding for repetitive implementation and fixture generation so active days stay higher without increasing PR size.',
  ];

  const metricsToWatch = [];
  metricsToWatch.push(`Active days: ${fmtNumber(overall.avgMonthlyActiveDays, 1)} avg/month`);
  metricsToWatch.push(`Longest idle gap: ${fmtNumber(overall.longestIdleGapDays, 1)}d`);
  metricsToWatch.push(`Comments received: ${fmtNumber(overall.commentsReceived)} total`);

  return {
    insights,
    focusAreas: focusAreas.slice(0, 3),
    strategies,
    metricsToWatch,
    prompts: [
      'Which two recurring implementation steps should become agent-driven this month?',
      'Where did the largest idle gap come from, and what trigger will surface that blocker earlier next time?',
      'What pre-PR AI review routine will reduce threaded comments without slowing delivery?',
      'Which metric should move first next month: touched story points, active days, PR size, or review contribution?',
    ],
    nextSteps: [
      'Break the next medium-sized ticket into an agent-generated plan with one small first PR and explicit follow-up slices.',
      'Use AI-generated tests and acceptance-check coverage before requesting review on every PR.',
      'Review the KPI sheet weekly and note which AI workflow materially changed throughput or review quality.',
    ],
  };
}

function buildQaNarrative(person, benchmarks) {
  const monthly = person.monthly;
  const overall = person.overall;
  const resultsTrend = trendWindow(monthly, 'totalResults');
  const assignedStoryPoints = overall.assignedStoryPoints ?? 0;
  const assignedTicketCount = overall.assignedTicketCount ?? 0;
  const complexityVsMedian = percentageDelta(assignedStoryPoints, benchmarks.assignedStoryPoints);

  const insights = [
    `${fmtNumber(overall.totalResults)} TestRail results were logged across ${fmtNumber(overall.avgActiveDays, 1)} active days per month with a weighted pass rate of ${fmtPct(overall.passRate, 0)}.`,
    `${fmtNumber(assignedTicketCount)} Jira tickets totaling ${fmtNumber(assignedStoryPoints, 1)} story points were attributed through the QA Assignees field, giving complexity context behind the run volume.`,
    `${fmtNumber(overall.defectsLinked)} linked defects and ${fmtNumber(overall.commentsLogged)} commented results show how often execution evidence was captured.`,
    `${fmtNumber(overall.github?.mergedPrs ?? null)} automation PRs merged, changing ${fmtNumber(overall.github?.testAssetFilesChanged ?? null)} test assets across ${fmtNumber(overall.github?.featureCoverageBreadth ?? null)} feature areas.`,
  ];

  const focusAreas = [];
  if ((overall.passRate ?? 0) < (benchmarks.passRate ?? 0) || (overall.failurePressureRate ?? 0) > (benchmarks.failurePressureRate ?? 0)) {
    focusAreas.push(`Execution quality: pass rate is ${fmtPct(overall.passRate, 0)} with failure pressure at ${fmtPct(overall.failurePressureRate, 0)}.`);
  }
  if ((overall.avgActiveDays ?? 0) < (benchmarks.avgActiveDays ?? 0) || (overall.avgResultsPerActiveDay ?? 0) < (benchmarks.avgResultsPerActiveDay ?? 0)) {
    focusAreas.push(`Execution cadence: average active days are ${fmtNumber(overall.avgActiveDays, 1)} and results per active day are ${fmtNumber(overall.avgResultsPerActiveDay, 1)}.`);
  }
  if ((overall.totalResults ?? 0) < (benchmarks.totalResults ?? 0) && (complexityVsMedian ?? 0) > 0.12) {
    focusAreas.push(`Complexity context: assigned feature scope is ${fmtNumber(assignedStoryPoints, 1)} story points across ${fmtNumber(assignedTicketCount)} tickets, above the QA median, so raw run count should be read against heavier work items.`);
  } else if ((overall.totalResults ?? 0) < (benchmarks.totalResults ?? 0) && (overall.assignedStoryPoints ?? 0) < (benchmarks.assignedStoryPoints ?? 0)) {
    focusAreas.push(`Throughput: assigned complexity is ${fmtNumber(assignedStoryPoints, 1)} story points, below the QA median, so the next gain should come from faster execution and evidence capture rather than lighter scope.`);
  }
  if ((overall.github?.mergedPrs ?? 0) < (benchmarks.automationPrs ?? 0) || (overall.github?.featureCoverageBreadth ?? 0) < (benchmarks.featureBreadth ?? 0)) {
    focusAreas.push(`Automation leverage: merged automation PRs are ${fmtNumber(overall.github?.mergedPrs ?? null)} and coverage breadth is ${fmtNumber(overall.github?.featureCoverageBreadth ?? null)} feature areas.`);
  }
  if ((overall.defectsLinked ?? 0) < (benchmarks.defectsLinked ?? 0)) {
    focusAreas.push(`Evidence quality: defects linked are ${fmtNumber(overall.defectsLinked)} against a QA-group median of ${fmtNumber(benchmarks.defectsLinked)}.`);
  }
  if (resultsTrend.delta !== null && resultsTrend.delta < -0.1) {
    focusAreas.push(`Momentum: last-three-month TestRail output fell ${fmtPct(Math.abs(resultsTrend.delta), 0)} versus the first three months.`);
  }
  while (focusAreas.length < 3) {
    focusAreas.push('Use agents to draft test steps, coverage gaps, and bug evidence so more of the time goes into execution and automation decisions.');
  }

  return {
    insights,
    focusAreas: focusAreas.slice(0, 3),
    strategies: [
      'Use AI to generate test data, result comments, and bug repro templates so evidence quality improves without slowing execution.',
      'Turn repeated UI or API checks into agent-assisted automation scaffolds and reusable fixtures before the next regression cycle.',
      'Use AI triage on failed/retest clusters to decide whether the next move is defect linkage, automation hardening, or environment stabilization.',
    ],
    metricsToWatch: [
      `Pass rate: ${fmtPct(overall.passRate, 0)}`,
      `Results per active day: ${fmtNumber(overall.avgResultsPerActiveDay, 1)}`,
      `Assigned story points: ${fmtNumber(overall.assignedStoryPoints, 1)}`,
      `Automation PRs merged: ${fmtNumber(overall.github?.mergedPrs ?? null)}`,
    ],
    prompts: [
      'Which manual test paths should become agent-assisted automation in the next sprint?',
      'Where is failure pressure coming from: product defects, flaky automation, or environment setup?',
      'Which result-comment or defect-linking step should be templated so evidence quality rises without slowing execution?',
      'Which metric should move first next month: pass rate, execution cadence, automation PRs, or coverage breadth?',
    ],
    nextSteps: [
      'Start each regression window with an AI-generated coverage checklist and execution order based on recent failures and change scope.',
      'Use agents to draft reproducible bug summaries and TestRail result comments for every failed or retest outcome.',
      'Choose one repetitive manual area and ship one automation improvement or framework hardening PR before the next monthly review.',
    ],
  };
}

function addSlideBackground(slide) {
  slide.background = { color: COLORS.bg };
}

function addHeader(slide, eyebrow, title, subtitle) {
  slide.addText(eyebrow.toUpperCase(), {
    x: SLIDE.marginX,
    y: 0.2,
    w: 4.0,
    h: 0.25,
    fontFace: 'Aptos',
    fontSize: 9,
    color: COLORS.blue,
    bold: false,
    charSpace: 1.5,
  });
  slide.addText(title, {
    x: SLIDE.marginX,
    y: 0.48,
    w: 7.2,
    h: 0.44,
    fontFace: 'Aptos',
    fontSize: 23,
    bold: true,
    color: COLORS.text,
  });
  slide.addText(subtitle, {
    x: SLIDE.marginX,
    y: 0.9,
    w: 8.8,
    h: 0.28,
    fontFace: 'Aptos',
    fontSize: 10.5,
    color: COLORS.muted,
  });
}

function addPanel(slide, x, y, w, h, options = {}) {
  slide.addShape('roundRect', {
    x, y, w, h,
    rectRadius: 0.08,
    line: { color: options.borderColor ?? COLORS.border, width: 1 },
    fill: { color: options.fillColor ?? COLORS.panel },
  });
}

function addKpiCard(slide, x, y, w, h, label, value, subtext, accent = COLORS.blue) {
  addPanel(slide, x, y, w, h, { fillColor: COLORS.panel });
  const compactCard = h < 0.95;
  slide.addText(label, {
    x: x + 0.12, y: y + 0.09, w: w - 0.24, h: 0.16,
    fontFace: 'Aptos', fontSize: 9, color: COLORS.muted, bold: false,
  });
  slide.addText(value, {
    x: x + 0.12, y: compactCard ? y + 0.29 : y + 0.24, w: w - 0.24, h: compactCard ? 0.2 : 0.24,
    fontFace: 'Aptos', fontSize: compactCard ? 15.5 : 16.5, color: COLORS.text, bold: true,
  });
  slide.addShape('rect', {
    x: x + 0.12, y: y + h - 0.13, w: w - 0.24, h: 0.035,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
  if (subtext && !compactCard) {
    slide.addText(subtext, {
      x: x + 0.12, y: y + h - 0.32, w: w - 0.24, h: 0.14,
      fontFace: 'Aptos', fontSize: 7.8, color: COLORS.muted,
    });
  }
}

function addBulletPanel(slide, x, y, w, h, title, bullets) {
  addPanel(slide, x, y, w, h, { fillColor: COLORS.panel });
  slide.addText(title, {
    x: x + 0.14, y: y + 0.12, w: w - 0.28, h: 0.24,
    fontFace: 'Aptos', fontSize: 11.5, bold: true, color: COLORS.text,
  });
  const contentTop = y + 0.42;
  const contentBottom = y + h - 0.12;
  const gap = 0.05;
  const availableHeight = Math.max(0.3, contentBottom - contentTop);
  const bulletHeight = Math.min(0.42, Math.max(0.18, (availableHeight - gap * Math.max(bullets.length - 1, 0)) / Math.max(bullets.length, 1)));
  const bulletFontSize = bulletHeight < 0.28 ? 8.2 : bulletHeight < 0.34 ? 8.8 : 9.4;
  let currentY = contentTop;
  for (const bullet of bullets) {
    slide.addText([
      { text: '• ', options: { color: COLORS.blue, bold: true } },
      { text: bullet, options: { color: COLORS.text } },
    ], {
      x: x + 0.14,
      y: currentY,
      w: w - 0.28,
      h: bulletHeight,
      fontFace: 'Aptos',
      fontSize: bulletFontSize,
      margin: 0,
      valign: 'top',
    });
    currentY += bulletHeight + gap;
  }
}

function addMetricCardGrid(slide, x, y, w, h, cards, columns = 4) {
  const rows = Math.ceil(cards.length / columns);
  const gapX = 0.12;
  const gapY = 0.12;
  const cardW = (w - gapX * (columns - 1)) / columns;
  const cardH = (h - gapY * (rows - 1)) / rows;
  cards.forEach((card, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    addKpiCard(slide, x + col * (cardW + gapX), y + row * (cardH + gapY), cardW, cardH, card.label, card.value, card.subtext, card.accent);
  });
}

function addBarTrendPanel(slide, x, y, w, h, title, months, values, formatter, color, betterHigh = true) {
  addPanel(slide, x, y, w, h, { fillColor: COLORS.panel });
  slide.addText(title, {
    x: x + 0.12, y: y + 0.1, w: w - 0.24, h: 0.2,
    fontFace: 'Aptos', fontSize: 10.5, bold: true, color: COLORS.text,
  });
  const cleanValues = values.map((value) => (Number.isFinite(value) ? value : 0));
  const maxValue = Math.max(...cleanValues, 0);
  const chartX = x + 0.12;
  const chartY = y + 0.45;
  const chartW = w - 0.24;
  const chartH = h - 0.72;
  const stepW = chartW / months.length;

  months.forEach((month, index) => {
    const value = cleanValues[index];
    const barHeight = maxValue > 0 ? Math.max(0.04, (value / maxValue) * (chartH - 0.35)) : 0.04;
    const barX = chartX + index * stepW + stepW * 0.18;
    const barW = stepW * 0.54;
    const barY = chartY + (chartH - barHeight - 0.18);
    slide.addShape('rect', {
      x: barX,
      y: barY,
      w: barW,
      h: barHeight,
      line: { color, transparency: 100 },
      fill: { color },
    });
    slide.addText(formatter(values[index]), {
      x: chartX + index * stepW,
      y: chartY + chartH - 0.16,
      w: stepW,
      h: 0.18,
      fontFace: 'Aptos',
      fontSize: 7.6,
      color: COLORS.text,
      align: 'center',
    });
    slide.addText(month.label.replace(' 20', '\n20'), {
      x: chartX + index * stepW,
      y: y + h - 0.26,
      w: stepW,
      h: 0.22,
      fontFace: 'Aptos',
      fontSize: 7.2,
      color: COLORS.muted,
      align: 'center',
    });
  });

  const latest = values.at(-1) ?? null;
  const first = values[0] ?? null;
  const delta = latest !== null && first !== null && Number.isFinite(latest) && Number.isFinite(first) && first !== 0
    ? (latest - first) / first
    : null;
  const footer = delta === null
    ? `Latest ${formatter(latest)}`
    : `${delta >= 0 ? 'Up' : 'Down'} ${fmtPct(Math.abs(delta), 0)} from ${months[0].label}`;
  slide.addText(footer, {
    x: x + 0.12, y: y + 0.26, w: w - 0.24, h: 0.14,
    fontFace: 'Aptos', fontSize: 8, color: betterHigh ? COLORS.muted : COLORS.muted,
  });
}

function drawTable(slide, x, y, w, h, headers, rows, colWeights) {
  const rowCount = rows.length + 1;
  const rowH = h / rowCount;
  const totalWeight = colWeights.reduce((sum, value) => sum + value, 0);
  const colWidths = colWeights.map((value) => (value / totalWeight) * w);
  let currentY = y;

  function drawCell(cellX, cellY, cellW, cellH, text, opts = {}) {
    slide.addShape('rect', {
      x: cellX, y: cellY, w: cellW, h: cellH,
      line: { color: COLORS.border, width: 0.7 },
      fill: { color: opts.fillColor ?? COLORS.panel },
    });
    slide.addText(text, {
      x: cellX + 0.04,
      y: cellY + 0.02,
      w: cellW - 0.08,
      h: cellH - 0.04,
      fontFace: 'Aptos',
      fontSize: opts.fontSize ?? 8.3,
      bold: opts.bold ?? false,
      color: opts.color ?? COLORS.text,
      margin: 0,
      align: opts.align ?? 'center',
      valign: 'mid',
      breakLine: false,
    });
  }

  let currentX = x;
  headers.forEach((header, index) => {
    drawCell(currentX, currentY, colWidths[index], rowH, header, {
      fillColor: COLORS.softPanel,
      bold: true,
      fontSize: 8.1,
      color: COLORS.text,
    });
    currentX += colWidths[index];
  });

  rows.forEach((row, rowIndex) => {
    currentY = y + rowH * (rowIndex + 1);
    currentX = x;
    row.forEach((cell, index) => {
      drawCell(currentX, currentY, colWidths[index], rowH, cell, {
        fontSize: 7.7,
        align: index === 0 ? 'left' : 'center',
      });
      currentX += colWidths[index];
    });
  });
}

function monthsShort() {
  return MONTHS.map((month) => ({ label: month.label, key: month.key }));
}

function buildDeveloperDeck(person, benchmarks, outPath) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'OpenAI Codex';
  pptx.company = 'Veem';
  pptx.subject = `${person.member.name} productivity summary`;
  pptx.title = `${person.member.name} — Productivity summary`;
  pptx.theme = {
    headFontFace: 'Aptos',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  };

  const narrative = buildDeveloperNarrative(person, benchmarks);
  const monthly = person.monthly;
  const overall = person.overall;
  const monthMeta = monthsShort();

  let slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Developer productivity summary', `${person.member.name} — Productivity summary`, `${person.member.team} engineering • ${WINDOW_MONTH_COUNT_LABEL} view from ${WINDOW_LABEL}`);
  addMetricCardGrid(slide, 0.45, 1.25, 5.95, 1.8, [
    { label: 'Total LOC changed', value: fmtNumber(overall.totalLocChanged), subtext: rankLabel(overall.totalLocChanged, benchmarks.totalLocChanged, true), accent: COLORS.blue },
    { label: 'LOC changed per story point', value: fmtNumber(overall.locPerStoryPoint, 1), subtext: rankLabel(overall.locPerStoryPoint, benchmarks.locPerStoryPoint, true), accent: COLORS.orange },
    { label: 'Touched ticket SP', value: fmtNumber(overall.touchedTicketStoryPoints, 1), subtext: `Across ${fmtNumber(overall.totalPRs)} merged PRs`, accent: COLORS.green },
    { label: 'Avg active days / month', value: fmtNumber(overall.avgMonthlyActiveDays, 1), subtext: rankLabel(overall.avgMonthlyActiveDays, benchmarks.avgMonthlyActiveDays, true), accent: COLORS.purple },
  ], 2);
  addBulletPanel(slide, 6.6, 1.25, 6.25, 1.75, `What the ${WINDOW_MONTH_COUNT_LABEL} view says`, narrative.insights);
  addBulletPanel(slide, 0.45, 3.2, 12.4, 2.0, 'What to move next with agentic coding', narrative.focusAreas);
  addBulletPanel(slide, 0.45, 5.34, 12.4, 1.9, 'Immediate leverage points', narrative.strategies);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Monthly productivity trends', `${person.member.name} — Monthly productivity trends`, 'LOC, story points, active days, and flow metrics first, followed by PR shape.');
  const panels = [
    ['LOC changed', monthly.map((item) => item.totalLocChanged), (value) => fmtNumber(value), COLORS.blue],
    ['Touched ticket SP', monthly.map((item) => item.touchedTicketStoryPoints), (value) => fmtNumber(value, 1), COLORS.green],
    ['Active days', monthly.map((item) => item.activeDays), (value) => fmtNumber(value), COLORS.orange],
    ['LOC per story point', monthly.map((item) => item.locPerStoryPoint), (value) => fmtNumber(value, 1), COLORS.purple],
    ['Median PR size', monthly.map((item) => item.medianLocPerPR), (value) => fmtNumber(value, 1), COLORS.blue],
    ['Longest idle gap (days)', monthly.map((item) => item.longestIdleGapDays), (value) => fmtNumber(value, 1), COLORS.red],
  ];
  panels.forEach(([title, values, formatter, color], index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    addBarTrendPanel(slide, 0.45 + col * 4.15, 1.25 + row * 2.45, 3.85, 2.2, title, monthMeta, values, formatter, color);
  });

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Review and collaboration trends', `${person.member.name} — Review and collaboration trends`, 'Review counts and comment volume highlight collaboration leverage and pre-review cleanup pressure.');
  addMetricCardGrid(slide, 0.45, 1.25, 12.4, 2.0, [
    { label: 'Reviews completed', value: fmtNumber(overall.reviewsCompleted), subtext: rankLabel(overall.reviewsCompleted, benchmarks.reviewsCompleted, true), accent: COLORS.blue },
    { label: 'Comments given', value: fmtNumber(overall.commentsGiven), subtext: `${fmtNumber(overall.commentsGiven / Math.max(overall.reviewsCompleted || 1, 1), 2)} comments / review`, accent: COLORS.orange },
    { label: 'Reviews received', value: fmtNumber(overall.reviewsReceived), subtext: `${fmtNumber(overall.commentsReceived)} comments received`, accent: COLORS.green },
    { label: 'Comments received', value: fmtNumber(overall.commentsReceived), subtext: rankLabel(overall.reviewsReceived ? overall.commentsReceived / overall.reviewsReceived : null, benchmarks.commentsReceivedPerReview, false), accent: COLORS.red },
  ], 4);
  addBarTrendPanel(slide, 0.45, 3.55, 6.05, 2.1, 'Reviews completed by month', monthMeta, monthly.map((item) => item.givenReviews), (value) => fmtNumber(value), COLORS.blue);
  addBarTrendPanel(slide, 6.8, 3.55, 6.05, 2.1, 'Comments received by month', monthMeta, monthly.map((item) => item.commentsReceived), (value) => fmtNumber(value), COLORS.orange, false);
  addBulletPanel(slide, 0.45, 5.9, 12.4, 0.95, 'Summary', [
    `Completed ${fmtNumber(overall.reviewsCompleted)} reviews and left ${fmtNumber(overall.commentsGiven)} threaded comments during the ${WINDOW_MONTH_COUNT_LABEL} window.`,
    `Owned PRs received ${fmtNumber(overall.reviewsReceived)} reviews and ${fmtNumber(overall.commentsReceived)} threaded comments.`,
  ]);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Month-by-month table', `${person.member.name} — Month-by-month table`, 'Priority metrics stay first. Additional tracked metrics are available in the companion workbook.');
  drawTable(
    slide,
    0.45,
    1.25,
    12.4,
    4.65,
    ['Month', 'LOC', 'LOC / SP', 'Active Days', 'Touched SP', 'Median PR Size', 'Idle Gap', 'Reviews Completed (Comments)', 'Reviews Received (Comments)'],
    monthly.map((item) => [
      item.month,
      fmtNumber(item.totalLocChanged),
      fmtNumber(item.locPerStoryPoint, 1),
      fmtNumber(item.activeDays),
      fmtNumber(item.touchedTicketStoryPoints, 1),
      fmtNumber(item.medianLocPerPR, 1),
      fmtNumber(item.longestIdleGapDays, 1),
      `${fmtNumber(item.givenReviews)} (${fmtNumber(item.commentsGiven)})`,
      `${fmtNumber(item.receivedReviews)} (${fmtNumber(item.commentsReceived)})`,
    ]),
    [1.2, 1, 1, 0.9, 1, 1.1, 0.9, 1.5, 1.5],
  );
  addBulletPanel(slide, 0.45, 6.08, 12.4, 0.8, 'Other tracked metrics', [
    `Active day rate ranged from ${fmtPct(Math.min(...monthly.map((item) => item.activeDayRate)), 0)} to ${fmtPct(Math.max(...monthly.map((item) => item.activeDayRate)), 0)}.`,
    `Average Jira-linked cycle time this period was ${fmtDays(overall.avgIssueCycleDays, 1)} and average coding time was ${fmtHours(overall.avgCodingHours, 1)}.`,
  ]);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Agentic coding focus', `${person.member.name} — Agentic coding focus`, 'Use the numbers to shape an easier adoption strategy, not to chase vanity KPIs.');
  addBulletPanel(slide, 0.45, 1.25, 4.0, 3.0, 'Where this developer benefits most', narrative.focusAreas);
  addBulletPanel(slide, 4.67, 1.25, 4.0, 3.0, 'Easier adoption strategy', narrative.strategies);
  addBulletPanel(slide, 8.89, 1.25, 3.96, 3.0, 'Metrics to watch next month', narrative.metricsToWatch);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, '1:1 discussion prompts and next steps', `${person.member.name} — 1:1 discussion prompts and next steps`, 'Centered on quantitative follow-up and practical AI adoption.');
  addBulletPanel(slide, 0.45, 1.25, 6.05, 4.4, '1:1 discussion prompts', narrative.prompts);
  addBulletPanel(slide, 6.8, 1.25, 6.05, 4.4, 'Next steps', narrative.nextSteps);

  return pptx.writeFile({ fileName: outPath });
}

function buildQaDeck(person, benchmarks, outPath) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'OpenAI Codex';
  pptx.company = 'Veem';
  pptx.subject = `${person.member.name} QA productivity summary`;
  pptx.title = `${person.member.name} — QA productivity summary`;
  pptx.theme = {
    headFontFace: 'Aptos',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  };

  const narrative = buildQaNarrative(person, benchmarks);
  const monthly = person.monthly;
  const overall = person.overall;
  const monthMeta = monthsShort();

  let slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'QA productivity summary', `${person.member.name} — QA productivity summary`, `${person.member.team} QA • ${WINDOW_MONTH_COUNT_LABEL} view from ${WINDOW_LABEL}`);
  addMetricCardGrid(slide, 0.45, 1.25, 5.95, 1.8, [
    { label: 'Total results logged', value: fmtNumber(overall.totalResults), subtext: rankLabel(overall.totalResults, benchmarks.totalResults, true), accent: COLORS.blue },
    { label: 'Weighted pass rate', value: fmtPct(overall.passRate, 0), subtext: rankLabel(overall.passRate, benchmarks.passRate, true), accent: COLORS.green },
    { label: 'Avg active days / month', value: fmtNumber(overall.avgActiveDays, 1), subtext: rankLabel(overall.avgActiveDays, benchmarks.avgActiveDays, true), accent: COLORS.orange },
    { label: 'Assigned Jira tickets', value: fmtNumber(overall.assignedTicketCount), subtext: rankLabel(overall.assignedTicketCount, benchmarks.assignedTicketCount, true), accent: COLORS.red },
    { label: 'Assigned Jira story points', value: fmtNumber(overall.assignedStoryPoints, 1), subtext: rankLabel(overall.assignedStoryPoints, benchmarks.assignedStoryPoints, true), accent: COLORS.purple },
    { label: 'Automation PRs merged', value: fmtNumber(overall.github?.mergedPrs ?? null), subtext: rankLabel(overall.github?.mergedPrs ?? null, benchmarks.automationPrs, true), accent: COLORS.blue },
  ], 3);
  addBulletPanel(slide, 6.6, 1.25, 6.25, 1.75, `What the ${WINDOW_MONTH_COUNT_LABEL} view says`, narrative.insights);
  addBulletPanel(slide, 0.45, 3.2, 12.4, 2.0, 'What to move next with agentic QA', narrative.focusAreas);
  addBulletPanel(slide, 0.45, 5.34, 12.4, 1.9, 'Immediate leverage points', narrative.strategies);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Monthly QA trends', `${person.member.name} — Monthly QA trends`, 'Execution, quality, and workload signals first, followed by effort and outcome mix.');
  const panels = [
    ['Results logged', monthly.map((item) => item.totalResults), (value) => fmtNumber(value), COLORS.blue],
    ['Assigned Jira story points', monthly.map((item) => item.jiraAssignedStoryPoints), (value) => fmtNumber(value, 1), COLORS.purple],
    ['Assigned Jira tickets', monthly.map((item) => item.jiraAssignedTicketCount), (value) => fmtNumber(value), COLORS.red],
    ['Pass rate', monthly.map((item) => item.passRate), (value) => fmtPct(value, 0), COLORS.orange],
    ['Failure pressure', monthly.map((item) => item.failurePressureRate), (value) => fmtPct(value, 0), COLORS.red],
    ['Active days', monthly.map((item) => item.activeDays), (value) => fmtNumber(value), COLORS.purple],
    ['Avg execution time', monthly.map((item) => item.avgElapsedSeconds !== null && item.avgElapsedSeconds !== undefined ? item.avgElapsedSeconds / 3600 : null), (value) => fmtHours(value, 1), COLORS.green],
  ];
  panels.forEach(([title, values, formatter, color], index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    addBarTrendPanel(slide, 0.45 + col * 4.15, 1.25 + row * 2.45, 3.85, 2.2, title, monthMeta, values, formatter, color);
  });

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Execution evidence and automation delivery', `${person.member.name} — Execution evidence and automation delivery`, 'TestRail evidence stays primary while GitHub shows automation delivery and framework leverage.');
  addMetricCardGrid(slide, 0.45, 1.25, 12.4, 2.05, [
    { label: 'Comments logged', value: fmtNumber(overall.commentsLogged), subtext: 'Result comments with context', accent: COLORS.blue },
    { label: 'Defects linked', value: fmtNumber(overall.defectsLinked), subtext: rankLabel(overall.defectsLinked, benchmarks.defectsLinked, true), accent: COLORS.red },
    { label: 'Results / active day', value: fmtNumber(overall.avgResultsPerActiveDay, 1), subtext: rankLabel(overall.avgResultsPerActiveDay, benchmarks.avgResultsPerActiveDay, true), accent: COLORS.orange },
    { label: 'Runs touched', value: fmtNumber(overall.runsTouched), subtext: `Across the ${WINDOW_MONTH_COUNT_LABEL} window`, accent: COLORS.green },
    { label: 'Assigned tickets', value: fmtNumber(overall.assignedTicketCount), subtext: rankLabel(overall.assignedTicketCount, benchmarks.assignedTicketCount, true), accent: COLORS.purple },
    { label: 'Assigned story points', value: fmtNumber(overall.assignedStoryPoints, 1), subtext: rankLabel(overall.assignedStoryPoints, benchmarks.assignedStoryPoints, true), accent: COLORS.blue },
    { label: 'Automation PRs', value: fmtNumber(overall.github?.mergedPrs ?? null), subtext: 'Merged to main', accent: COLORS.purple },
    { label: 'Test assets changed', value: fmtNumber(overall.github?.testAssetFilesChanged ?? null), subtext: rankLabel(overall.github?.testAssetFilesChanged ?? null, benchmarks.testAssets, true), accent: COLORS.blue },
    { label: 'Engineering files', value: fmtNumber(overall.github?.engineeringFilesChanged ?? null), subtext: 'Framework / CI / harness', accent: COLORS.orange },
    { label: 'Feature breadth', value: fmtNumber(overall.github?.featureCoverageBreadth ?? null), subtext: rankLabel(overall.github?.featureCoverageBreadth ?? null, benchmarks.featureBreadth, true), accent: COLORS.green },
  ], 5);
  addBulletPanel(slide, 0.45, 3.65, 12.4, 1.35, 'Summary', [
    `${fmtNumber(overall.totalResults)} total TestRail results, ${fmtPct(overall.passRate, 0)} weighted pass rate, and ${fmtNumber(overall.commentsLogged)} commented outcomes across the ${WINDOW_MONTH_COUNT_LABEL} window.`,
    `${fmtNumber(overall.assignedTicketCount)} Jira tickets worth ${fmtNumber(overall.assignedStoryPoints, 1)} story points provide the workload-complexity baseline for the same period.`,
    `${fmtNumber(overall.github?.mergedPrs ?? null)} automation PRs touched ${fmtNumber(overall.github?.testAssetFilesChanged ?? null)} test assets and ${fmtNumber(overall.github?.featureCoverageBreadth ?? null)} feature areas.`,
  ]);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Month-by-month table', `${person.member.name} — Month-by-month table`, 'QA-specific delivery, evidence, and automation metrics by month.');
  drawTable(
    slide,
    0.45,
    1.25,
    12.4,
    4.65,
    ['Month', 'Project', 'Results', 'Assigned Tickets', 'Assigned SP', 'Pass Rate', 'Failure Pressure', 'Active Days', 'Comments', 'Defects', 'Automation PRs', 'Breadth'],
    monthly.map((item) => [
      item.month,
      item.projectName.replace('VeemTestEngineering', 'VTE'),
      fmtNumber(item.totalResults),
      fmtNumber(item.jiraAssignedTicketCount),
      fmtNumber(item.jiraAssignedStoryPoints, 1),
      fmtPct(item.passRate, 0),
      fmtPct(item.failurePressureRate, 0),
      fmtNumber(item.activeDays),
      fmtNumber(item.commentsLogged),
      fmtNumber(item.defectsLinked),
      fmtNumber(item.githubMergedPrs ?? null),
      fmtNumber(item.githubFeatureCoverageBreadth ?? null),
    ]),
    [0.9, 1.0, 0.85, 1.0, 0.95, 0.85, 1.0, 0.8, 0.75, 0.75, 0.95, 0.85],
  );
  addBulletPanel(slide, 0.45, 6.08, 12.4, 0.8, 'Other tracked metrics', [
    `Average execution time ranged from ${fmtHours(Math.min(...monthly.map((item) => item.avgElapsedSeconds ? item.avgElapsedSeconds / 3600 : Infinity)), 1)} to ${fmtHours(Math.max(...monthly.map((item) => item.avgElapsedSeconds ? item.avgElapsedSeconds / 3600 : 0)), 1)}.`,
    `Runs assigned, created, and completed-owned are available in the companion workbook for deeper operational analysis.`,
  ]);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, 'Agentic QA focus', `${person.member.name} — Agentic QA focus`, 'Use the numbers to increase execution leverage and automation quality, not to chase raw output.');
  addBulletPanel(slide, 0.45, 1.25, 4.0, 3.0, 'Where this QA resource benefits most', narrative.focusAreas);
  addBulletPanel(slide, 4.67, 1.25, 4.0, 3.0, 'Easier adoption strategy', narrative.strategies);
  addBulletPanel(slide, 8.89, 1.25, 3.96, 3.0, 'Metrics to watch next month', narrative.metricsToWatch);

  slide = pptx.addSlide();
  addSlideBackground(slide);
  addHeader(slide, '1:1 discussion prompts and next steps', `${person.member.name} — 1:1 discussion prompts and next steps`, 'Centered on quantitative QA improvement and practical AI adoption.');
  addBulletPanel(slide, 0.45, 1.25, 6.05, 4.4, '1:1 discussion prompts', narrative.prompts);
  addBulletPanel(slide, 6.8, 1.25, 6.05, 4.4, 'Next steps', narrative.nextSteps);

  return pptx.writeFile({ fileName: outPath });
}

function addSheetHeader(sheet, columns) {
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 18,
    style: column.style ?? {},
  }));
  sheet.getRow(1).font = { bold: true, name: 'Aptos', size: 11 };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

async function buildDeveloperWorkbook(devPeople, outPath) {
  const workbook = new ExcelJS.Workbook();
  const monthlySheet = workbook.addWorksheet('monthly_metrics');
  const summarySheet = workbook.addWorksheet('six_month_summary');

  addSheetHeader(monthlySheet, [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Team', key: 'team', width: 10 },
    { header: 'GitHub Login', key: 'githubLogin', width: 22 },
    { header: 'Jira Email', key: 'jiraEmail', width: 30 },
    { header: 'Month', key: 'month', width: 12 },
    { header: 'From', key: 'from', width: 12 },
    { header: 'To', key: 'to', width: 12 },
    { header: 'Total PRs', key: 'totalPRs', width: 11 },
    { header: 'Additions', key: 'totalAdditions', width: 11 },
    { header: 'Deletions', key: 'totalDeletions', width: 11 },
    { header: 'LOC Changed', key: 'totalLocChanged', width: 13 },
    { header: 'Touched Ticket SP', key: 'touchedTicketStoryPoints', width: 16 },
    { header: 'LOC / Story Point', key: 'locPerStoryPoint', width: 16 },
    { header: 'Active Days', key: 'activeDays', width: 11 },
    { header: 'Active Day Rate', key: 'activeDayRate', width: 13 },
    { header: 'Median LOC / PR', key: 'medianLocPerPR', width: 14 },
    { header: 'Avg LOC / PR', key: 'avgLocPerPR', width: 13 },
    { header: 'Avg LOC / Active Day', key: 'avgLocPerActiveDay', width: 17 },
    { header: 'Longest Idle Gap Days', key: 'longestIdleGapDays', width: 18 },
    { header: 'Burstiest Day Share', key: 'burstiestDayShare', width: 15 },
    { header: 'Avg Days Between PRs', key: 'avgDaysBetweenPRs', width: 17 },
    { header: 'Reviews Given', key: 'givenReviews', width: 12 },
    { header: 'Comments Given', key: 'commentsGiven', width: 13 },
    { header: 'Reviewed PRs', key: 'reviewedPRs', width: 12 },
    { header: 'Approvals Given', key: 'approvalsGiven', width: 13 },
    { header: 'Change Requests Given', key: 'changeRequestsGiven', width: 18 },
    { header: 'Comment Reviews Given', key: 'commentReviewsGiven', width: 18 },
    { header: 'Reviews Received', key: 'receivedReviews', width: 14 },
    { header: 'Comments Received', key: 'commentsReceived', width: 16 },
    { header: 'Reviewed Own PRs', key: 'reviewedOwnPRs', width: 15 },
    { header: 'Approvals Received', key: 'approvalsReceived', width: 16 },
    { header: 'Change Requests Received', key: 'changeRequestsReceived', width: 20 },
    { header: 'Comment Reviews Received', key: 'commentReviewsReceived', width: 20 },
    { header: 'PR Cycle Sample Size', key: 'prCycleSampleSize', width: 16 },
    { header: 'Median First Commit -> Merge Hrs', key: 'medianFirstCommitToMergeHours', width: 24 },
    { header: 'Median Coding Hrs', key: 'medianCodingHours', width: 18 },
    { header: 'Median Last Commit -> Review Hrs', key: 'medianLastCommitToReviewHours', width: 25 },
    { header: 'Median Review -> Merge Hrs', key: 'medianReviewToMergeHours', width: 22 },
    { header: 'Jira Coding Sample Size', key: 'jiraCodingSampleSize', width: 19 },
    { header: 'Avg Coding Hrs', key: 'avgCodingHours', width: 15 },
    { header: 'Jira Cycle Sample Size', key: 'jiraCycleSampleSize', width: 18 },
    { header: 'Avg Jira Cycle Hrs', key: 'avgJiraCycleHours', width: 17 },
    { header: 'Issue Cycle Sample Size', key: 'issueCycleSampleSize', width: 19 },
    { header: 'Issue Cycle Completed Count', key: 'issueCycleCompletedCount', width: 21 },
    { header: 'Median Issue Cycle Hrs', key: 'medianIssueCycleHours', width: 20 },
    { header: 'Avg Issue Cycle Hrs', key: 'avgIssueCycleHours', width: 18 },
    { header: 'Weekdays Without Active Jira', key: 'weekdaysWithoutActiveJira', width: 21 },
    { header: 'Longest No-Active-Jira Gap', key: 'longestNoActiveJiraGap', width: 22 },
    { header: 'Warnings', key: 'warnings', width: 48 },
  ]);

  addSheetHeader(summarySheet, [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Team', key: 'team', width: 10 },
    { header: 'GitHub Login', key: 'githubLogin', width: 22 },
    { header: 'Total LOC Changed', key: 'totalLocChanged', width: 16 },
    { header: 'LOC / Story Point', key: 'locPerStoryPoint', width: 16 },
    { header: 'Touched Ticket SP', key: 'touchedTicketStoryPoints', width: 16 },
    { header: 'Avg Active Days / Month', key: 'avgMonthlyActiveDays', width: 20 },
    { header: 'Total PRs', key: 'totalPRs', width: 11 },
    { header: 'Active Day Rate', key: 'activeDayRate', width: 14 },
    { header: 'Median LOC / PR', key: 'medianLocPerPR', width: 15 },
    { header: 'Longest Idle Gap Days', key: 'longestIdleGapDays', width: 18 },
    { header: 'Burstiest Day Share', key: 'burstiestDayShare', width: 15 },
    { header: 'Avg Days Between PRs', key: 'avgDaysBetweenPRs', width: 17 },
    { header: 'Reviews Completed', key: 'reviewsCompleted', width: 15 },
    { header: 'Comments Given', key: 'commentsGiven', width: 14 },
    { header: 'Reviews Received', key: 'reviewsReceived', width: 15 },
    { header: 'Comments Received', key: 'commentsReceived', width: 16 },
    { header: 'Avg Issue Cycle Days', key: 'avgIssueCycleDays', width: 17 },
    { header: 'Avg Coding Hrs', key: 'avgCodingHours', width: 15 },
    { header: 'Avg Jira Cycle Hrs', key: 'avgCycleTimeHours', width: 17 },
  ]);

  for (const person of devPeople) {
    for (const month of person.monthly) {
      monthlySheet.addRow({
        name: person.member.name,
        team: person.member.team,
        githubLogin: person.member.githubLogin,
        jiraEmail: person.member.jiraEmail,
        ...month,
        warnings: month.warnings.join(' | '),
      });
    }
    summarySheet.addRow({
      name: person.member.name,
      team: person.member.team,
      githubLogin: person.member.githubLogin,
      ...person.overall,
    });
  }

  await workbook.xlsx.writeFile(outPath);
}

async function buildQaWorkbook(qaPeople, outPath) {
  const workbook = new ExcelJS.Workbook();
  const monthlySheet = workbook.addWorksheet('monthly_metrics');
  const summarySheet = workbook.addWorksheet('six_month_summary');

  addSheetHeader(monthlySheet, [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Team', key: 'team', width: 10 },
    { header: 'GitHub Login', key: 'githubLogin', width: 22 },
    { header: 'Jira User', key: 'jiraDisplayName', width: 26 },
    { header: 'Month', key: 'month', width: 12 },
    { header: 'Project', key: 'projectName', width: 22 },
    { header: 'From', key: 'from', width: 12 },
    { header: 'To', key: 'to', width: 12 },
    { header: 'Total Results', key: 'totalResults', width: 12 },
    { header: 'Unique Tests', key: 'uniqueTests', width: 12 },
    { header: 'Runs Touched', key: 'runsTouched', width: 12 },
    { header: 'Active Days', key: 'activeDays', width: 11 },
    { header: 'Avg Results / Active Day', key: 'avgResultsPerActiveDay', width: 20 },
    { header: 'Passed', key: 'passed', width: 10 },
    { header: 'Failed', key: 'failed', width: 10 },
    { header: 'Blocked', key: 'blocked', width: 10 },
    { header: 'Retest', key: 'retest', width: 10 },
    { header: 'Other Statuses', key: 'otherStatuses', width: 13 },
    { header: 'Pass Rate', key: 'passRate', width: 11 },
    { header: 'Failure Pressure', key: 'failurePressureRate', width: 14 },
    { header: 'Total Elapsed Seconds', key: 'totalElapsedSeconds', width: 18 },
    { header: 'Avg Elapsed Seconds', key: 'avgElapsedSeconds', width: 16 },
    { header: 'Median Elapsed Seconds', key: 'medianElapsedSeconds', width: 18 },
    { header: 'Comments Logged', key: 'commentsLogged', width: 14 },
    { header: 'Defects Linked', key: 'defectsLinked', width: 13 },
    { header: 'Runs Assigned', key: 'runsAssigned', width: 12 },
    { header: 'Runs Created', key: 'runsCreated', width: 12 },
    { header: 'Completed Owned Runs', key: 'completedOwnedRuns', width: 18 },
    { header: 'Assigned Jira Tickets', key: 'jiraAssignedTicketCount', width: 18 },
    { header: 'Assigned Jira Story Points', key: 'jiraAssignedStoryPoints', width: 20 },
    { header: 'Automation PRs Merged', key: 'githubMergedPrs', width: 18 },
    { header: 'Test Asset Files Changed', key: 'githubTestAssetFilesChanged', width: 20 },
    { header: 'GitHub Total LOC Changed', key: 'githubTotalLocChanged', width: 18 },
    { header: 'GitHub Median LOC / PR', key: 'githubMedianLocChangedPerPr', width: 18 },
    { header: 'GitHub Median Files / PR', key: 'githubMedianFilesChangedPerPr', width: 18 },
    { header: 'Engineering Files Changed', key: 'githubEngineeringFilesChanged', width: 18 },
    { header: 'Feature Coverage Breadth', key: 'githubFeatureCoverageBreadth', width: 18 },
    { header: 'Warnings', key: 'warnings', width: 48 },
  ]);

  addSheetHeader(summarySheet, [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Team', key: 'team', width: 10 },
    { header: 'GitHub Login', key: 'githubLogin', width: 22 },
    { header: 'Jira User', key: 'jiraDisplayName', width: 26 },
    { header: 'Total Results', key: 'totalResults', width: 12 },
    { header: 'Weighted Pass Rate', key: 'passRate', width: 15 },
    { header: 'Failure Pressure', key: 'failurePressureRate', width: 14 },
    { header: 'Avg Active Days / Month', key: 'avgActiveDays', width: 20 },
    { header: 'Avg Unique Tests / Month', key: 'avgUniqueTests', width: 20 },
    { header: 'Avg Results / Active Day', key: 'avgResultsPerActiveDay', width: 20 },
    { header: 'Assigned Jira Tickets', key: 'assignedTicketCount', width: 18 },
    { header: 'Assigned Jira Story Points', key: 'assignedStoryPoints', width: 20 },
    { header: 'Comments Logged', key: 'commentsLogged', width: 14 },
    { header: 'Defects Linked', key: 'defectsLinked', width: 13 },
    { header: 'Runs Touched', key: 'runsTouched', width: 12 },
    { header: 'Passed', key: 'passed', width: 10 },
    { header: 'Failed', key: 'failed', width: 10 },
    { header: 'Retest', key: 'retest', width: 10 },
    { header: 'Blocked', key: 'blocked', width: 10 },
    { header: 'Automation PRs Merged', key: 'githubMergedPrs', width: 18 },
    { header: 'Test Asset Files Changed', key: 'githubTestAssetFilesChanged', width: 20 },
    { header: 'GitHub Total LOC Changed', key: 'githubTotalLocChanged', width: 18 },
    { header: 'GitHub Median LOC / PR', key: 'githubMedianLocChangedPerPr', width: 18 },
    { header: 'GitHub Median Files / PR', key: 'githubMedianFilesChangedPerPr', width: 18 },
    { header: 'Engineering Files Changed', key: 'githubEngineeringFilesChanged', width: 18 },
    { header: 'Feature Coverage Breadth', key: 'githubFeatureCoverageBreadth', width: 18 },
  ]);

  for (const person of qaPeople) {
    for (const month of person.monthly) {
      monthlySheet.addRow({
        name: person.member.name,
        team: person.member.team,
        githubLogin: person.member.githubLogin,
        ...month,
        warnings: month.warnings.join(' | '),
      });
    }
    summarySheet.addRow({
      name: person.member.name,
      team: person.member.team,
      githubLogin: person.member.githubLogin,
      ...person.overall,
      githubMergedPrs: person.overall.github?.mergedPrs ?? null,
      githubTestAssetFilesChanged: person.overall.github?.testAssetFilesChanged ?? null,
      githubTotalLocChanged: person.overall.github?.totalLocChanged ?? null,
      githubMedianLocChangedPerPr: person.overall.github?.medianLocChangedPerPr ?? null,
      githubMedianFilesChangedPerPr: person.overall.github?.medianFilesChangedPerPr ?? null,
      githubEngineeringFilesChanged: person.overall.github?.engineeringFilesChanged ?? null,
      githubFeatureCoverageBreadth: person.overall.github?.featureCoverageBreadth ?? null,
    });
  }

  await workbook.xlsx.writeFile(outPath);
}

function buildManifest(devPeople, qaPeople, devWorkbookPath, qaWorkbookPath) {
  const devZipPath = path.join(archiveRoot, 'developer_decks.zip');
  const qaZipPath = path.join(archiveRoot, 'qa_decks.zip');
  const devCards = devPeople.map((person) => {
    const fileName = `${sanitizeFileName(person.member.name)}_developer_productivity_summary.pptx`;
    return `<li><a href="decks/developers/${fileName}">${person.member.name}</a> <span>${person.member.team}</span></li>`;
  }).join('');
  const qaCards = qaPeople.map((person) => {
    const fileName = `${sanitizeFileName(person.member.name)}_qa_productivity_summary.pptx`;
    return `<li><a href="decks/qas/${fileName}">${person.member.name}</a> <span>${person.member.team}</span></li>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Productivity Deck Artifacts</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 32px; background: #f6f8fc; color: #16213b; }
h1 { margin-top: 0; }
h2 { margin-top: 28px; }
ul { padding-left: 18px; }
li { margin: 6px 0; }
span { color: #61708a; margin-left: 8px; }
a { color: #2d6cdf; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<h1>Productivity Report Artifacts</h1>
<p><strong>Run ID:</strong> ${runId}</p>
<p><strong>Window:</strong> ${OVERALL_FROM} to ${OVERALL_TO}</p>
<p><strong>Months:</strong> ${MONTHS.map((month) => month.label).join(', ')}</p>
<p><a href="workbooks/${path.basename(devWorkbookPath)}">Developer raw metrics workbook</a></p>
<p><a href="workbooks/${path.basename(qaWorkbookPath)}">QA raw metrics workbook</a></p>
<p><a href="archives/${path.basename(devZipPath)}">Developer decks zip</a></p>
<p><a href="archives/${path.basename(qaZipPath)}">QA decks zip</a></p>
<h2>Developer decks</h2>
<ul>${devCards}</ul>
<h2>QA decks</h2>
<ul>${qaCards}</ul>
</body>
</html>`;
}

async function main() {
  ensureDir(outputBaseRoot);
  ensureDir(outputRoot);
  ensureDir(dataRoot);
  ensureDir(devDeckRoot);
  ensureDir(qaDeckRoot);
  ensureDir(workbookRoot);
  ensureDir(archiveRoot);

  const env = loadEnv(path.join(repoRoot, '.env'));
  const cookies = buildCookies(env);
  const devRoster = mergeRoster('dev-team', 'developer');
  const qaRoster = mergeRoster('qa-team', 'qa');
  const usersPayload = await fetchJson('/api/users', null, cookies.header);
  const jiraByEmail = new Map((usersPayload.jira ?? [])
    .filter((user) => user.emailAddress)
    .map((user) => [String(user.emailAddress).toLowerCase(), user]));
  const jiraByName = new Map((usersPayload.jira ?? [])
    .map((user) => [String(user.displayName).toLowerCase(), user]));
  const reuseSavedData = process.env.REPORT_REUSE_DATA === '1'
    && fs.existsSync(path.join(dataRoot, 'developers.json'))
    && fs.existsSync(path.join(dataRoot, 'qas.json'));

  logProgress(`Loaded rosters: ${devRoster.members.length} developers, ${qaRoster.members.length} QA resources.`);
  let devPeople;
  let qaPeople;
  if (reuseSavedData) {
    logProgress('Reusing saved normalized JSON datasets.');
    devPeople = readJson(path.join(dataRoot, 'developers.json'));
    qaPeople = readJson(path.join(dataRoot, 'qas.json'));
  } else {
    const qaCatalog = await fetchJson('/api/qa/catalog', null, cookies.header);
    const projectIdByName = new Map((qaCatalog.projects ?? []).map((project) => [project.name, project.id]));
    const qaUsersByProjectName = new Map();
    for (const projectName of Array.from(new Set(MONTHS.map((month) => month.qaProjectName)))) {
      const projectId = projectIdByName.get(projectName);
      if (!projectId) throw new Error(`Missing TestRail project ${projectName}`);
      logProgress(`Loading QA catalog for ${projectName} (${projectId})`);
      const projectCatalog = await fetchJson('/api/qa/catalog', { projectId }, cookies.header);
      qaUsersByProjectName.set(projectName, projectCatalog.users ?? []);
    }

    devPeople = await mapLimit(devRoster.members, PERSON_CONCURRENCY, async (member) => {
      logProgress(`Developer fetch start: ${member.name} (${member.githubLogin})`);
      const jiraUser = jiraByEmail.get(String(member.jiraEmail).toLowerCase())
        ?? jiraByName.get(String(member.jiraDisplayName).toLowerCase());
      if (!jiraUser) throw new Error(`Missing Jira account mapping for ${member.name}`);
      const monthlyRaw = await mapLimit(MONTHS, MONTH_CONCURRENCY, async (month) => {
        logProgress(`Developer month fetch: ${member.githubLogin} ${month.key}`);
        const raw = await fetchJson('/api/contributions', {
          login: member.githubLogin,
          jiraAccountId: jiraUser.accountId,
          from: month.from,
          to: month.to,
        }, cookies.header);
        return normalizeDevMonth(raw, month);
      });
      logProgress(`Developer overall fetch: ${member.githubLogin} ${OVERALL_FROM}..${OVERALL_TO}`);
      const overallRaw = await fetchJson('/api/contributions', {
        login: member.githubLogin,
        jiraAccountId: jiraUser.accountId,
        from: OVERALL_FROM,
        to: OVERALL_TO,
      }, cookies.header);
      logProgress(`Developer fetch done: ${member.name}`);
      return {
        member,
        jiraUser,
        monthly: monthlyRaw,
        overallRaw,
        overall: summarizeDevOverall(member, overallRaw, monthlyRaw),
      };
    });

    const peerByAlias = qaRoster.peerByAlias;
    qaPeople = await mapLimit(qaRoster.members, PERSON_CONCURRENCY, async (member) => {
      logProgress(`QA fetch start: ${member.name} (${member.githubLogin ?? 'no-gh'})`);
      const peerAlias = peerByAlias.get(member.alias);
      const peer = qaRoster.members.find((item) => item.alias === peerAlias) ?? qaRoster.members.find((item) => item.alias !== member.alias);
      if (!peer) throw new Error(`No QA peer available for ${member.name}`);
      const jiraUser = jiraByEmail.get(String(member.email).toLowerCase())
        ?? jiraByName.get(String(member.name).toLowerCase());
      const peerJiraUser = jiraByEmail.get(String(peer.email).toLowerCase())
        ?? jiraByName.get(String(peer.name).toLowerCase());

      const monthly = await mapLimit(MONTHS, MONTH_CONCURRENCY, async (month) => {
        logProgress(`QA month fetch: ${member.alias} ${month.key} ${month.qaProjectName}`);
        const projectId = projectIdByName.get(month.qaProjectName);
        const users = qaUsersByProjectName.get(month.qaProjectName) ?? [];
        const leftUser = users.find((user) => String(user.name).toLowerCase() === String(member.name).toLowerCase());
        const rightUser = users.find((user) => String(user.name).toLowerCase() === String(peer.name).toLowerCase());
        if (!projectId || !leftUser || !rightUser) {
          throw new Error(`Missing QA user mapping for ${member.name} / ${peer.name} in ${month.qaProjectName}`);
        }
        const raw = await fetchJson('/api/qa/compare', {
          projectId,
          from: month.from,
          to: month.to,
          leftUserId: leftUser.id,
          rightUserId: rightUser.id,
          leftJiraAccountId: jiraUser?.accountId,
          leftJiraDisplayName: jiraUser?.displayName,
          leftJiraEmail: jiraUser?.emailAddress,
          rightJiraAccountId: peerJiraUser?.accountId,
          rightJiraDisplayName: peerJiraUser?.displayName,
          rightJiraEmail: peerJiraUser?.emailAddress,
          leftGithubLogin: member.githubLogin,
          rightGithubLogin: peer.githubLogin,
        }, cookies.header);
        return normalizeQaMonth(raw, month, month.qaProjectName);
      });

      const overallProjectName = 'VeemTestEngineeringV26';
      const overallProjectId = projectIdByName.get(overallProjectName);
      const overallUsers = qaUsersByProjectName.get(overallProjectName) ?? [];
      const leftOverallUser = overallUsers.find((user) => String(user.name).toLowerCase() === String(member.name).toLowerCase());
      const rightOverallUser = overallUsers.find((user) => String(user.name).toLowerCase() === String(peer.name).toLowerCase());
      if (!overallProjectId || !leftOverallUser || !rightOverallUser) {
        throw new Error(`Missing QA overall mapping for ${member.name} in ${overallProjectName}`);
      }
      logProgress(`QA overall fetch: ${member.alias} ${OVERALL_FROM}..${OVERALL_TO} ${overallProjectName}`);
      const overallGithubRaw = await fetchJson('/api/qa/compare', {
        projectId: overallProjectId,
        from: OVERALL_FROM,
        to: OVERALL_TO,
        leftUserId: leftOverallUser.id,
        rightUserId: rightOverallUser.id,
        leftJiraAccountId: jiraUser?.accountId,
        leftJiraDisplayName: jiraUser?.displayName,
        leftJiraEmail: jiraUser?.emailAddress,
        rightJiraAccountId: peerJiraUser?.accountId,
        rightJiraDisplayName: peerJiraUser?.displayName,
        rightJiraEmail: peerJiraUser?.emailAddress,
        leftGithubLogin: member.githubLogin,
        rightGithubLogin: peer.githubLogin,
      }, cookies.header);
      logProgress(`QA fetch done: ${member.name}`);

      return {
        member,
        peer,
        jiraUser,
        peerJiraUser,
        monthly,
        overall: overallQaFromMonthly(member, monthly, overallGithubRaw.left),
      };
    });
  }

  qaPeople = await refreshQaJiraMetrics(qaPeople, jiraByEmail, jiraByName, env);
  logProgress('Refreshed QA Jira complexity metrics.');

  const devBenchmarks = teamBenchmarks(devPeople.map((person) => person.overall), qaPeople.map((person) => person.overall)).dev;
  const qaBenchmarks = teamBenchmarks(devPeople.map((person) => person.overall), qaPeople.map((person) => person.overall)).qa;

  fs.writeFileSync(path.join(dataRoot, 'developers.json'), JSON.stringify(devPeople, null, 2));
  fs.writeFileSync(path.join(dataRoot, 'qas.json'), JSON.stringify(qaPeople, null, 2));
  logProgress('Wrote normalized JSON datasets.');

  const developerWorkbookPath = path.join(workbookRoot, 'developers_raw_metrics.xlsx');
  const qaWorkbookPath = path.join(workbookRoot, 'qas_raw_metrics.xlsx');
  await buildDeveloperWorkbook(devPeople, developerWorkbookPath);
  await buildQaWorkbook(qaPeople, qaWorkbookPath);
  logProgress('Built Excel workbooks.');

  for (const person of devPeople) {
    const outPath = path.join(devDeckRoot, `${sanitizeFileName(person.member.name)}_developer_productivity_summary.pptx`);
    logProgress(`Building developer deck: ${person.member.name}`);
    await buildDeveloperDeck(person, devBenchmarks, outPath);
  }
  for (const person of qaPeople) {
    const outPath = path.join(qaDeckRoot, `${sanitizeFileName(person.member.name)}_qa_productivity_summary.pptx`);
    logProgress(`Building QA deck: ${person.member.name}`);
    await buildQaDeck(person, qaBenchmarks, outPath);
  }
  logProgress('All decks built.');

  const developerDeckZipPath = path.join(archiveRoot, 'developer_decks.zip');
  const qaDeckZipPath = path.join(archiveRoot, 'qa_decks.zip');
  zipDirectory(devDeckRoot, developerDeckZipPath);
  zipDirectory(qaDeckRoot, qaDeckZipPath);
  logProgress('Packed deck archives.');

  fs.writeFileSync(manifestPath, buildManifest(devPeople, qaPeople, developerWorkbookPath, qaWorkbookPath), 'utf8');
  const latestMetadata = {
    runId,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    monthCount: REPORT_MONTH_COUNT,
    months: MONTHS,
    overallFrom: OVERALL_FROM,
    overallTo: OVERALL_TO,
    manifest: manifestPath,
    developerWorkbook: developerWorkbookPath,
    qaWorkbook: qaWorkbookPath,
    developerDecks: devDeckRoot,
    qaDecks: qaDeckRoot,
    developerDeckZip: developerDeckZipPath,
    qaDeckZip: qaDeckZipPath,
  };
  fs.writeFileSync(latestRunMetadataPath, JSON.stringify(latestMetadata, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputBaseRoot, 'index.html'), buildLatestLandingPage(latestMetadata), 'utf8');

  console.log(JSON.stringify({
    runId,
    manifest: manifestPath,
    developerWorkbook: developerWorkbookPath,
    qaWorkbook: qaWorkbookPath,
    developerDecks: devDeckRoot,
    qaDecks: qaDeckRoot,
    developerDeckZip: developerDeckZipPath,
    qaDeckZip: qaDeckZipPath,
    latestMetadata: latestRunMetadataPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
