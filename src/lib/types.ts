// lib/types.ts

export interface PR {
  id: string;
  number: number;
  title: string;
  url: string;

  createdAt: string;       // ISO
  mergedAt: string | null; // ISO or null
  closedAt: string | null; // ISO or null
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;

  additions: number;
  deletions: number;
  repository: { owner: string; name: string };

  // extra timestamps used for lifecycle calculations
  firstReviewAt?: string | null;
  readyForReviewAt?: string | null;

  jiraKeys?: string[];
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  assignee?: string;
  resolutiondate?: string;
  storyPoints?: number;
  status?: string;
  url: string;

  // used by sprint helpers / UI
  created?: string;
  updated?: string;     // ✅ added for /api/stats “updated in window”
  issueType?: string;
  parentKey?: string;
  epicKey?: string;

  // NEW: phase timestamps (from changelog)
  todoAt?: string;
  inProgressAt?: string;
  reviewAt?: string;    // first time reaching a "review" status (Reviewed/Review/In Review)
  completeAt?: string;  // first time reaching Approved/Done (proxy for merged if no GitHub link)

  // NEW: phase durations (hours)
  inProgressToReviewHours?: number | null;
  reviewToCompleteHours?: number | null;
}

export interface KPIs {
  totalPRs: number;
  totalTicketsDone: number;
  totalStoryPoints: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface TimeseriesItem {
  date: string; // YYYY-MM-DD
  prCount: number;
  additions: number;
  deletions: number;
  tickets: number;
  storyPoints: number;
}

/* -------- Lifecycle (for /api/stats and PRLifecycle view) -------- */

export interface PRLifecycle {
  id: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  readyForReviewAt?: string | null;
  firstReviewAt?: string | null;
  mergedAt?: string | null;
  closedAt?: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;

  // LOC deltas
  additions?: number;
  deletions?: number;

  // computed (hours)
  timeToReadyHours?: number | null;
  timeToFirstReviewHours?: number | null;
  reviewToMergeHours?: number | null;
  cycleTimeHours?: number | null;
}

export interface LifecycleStats {
  sampleSize: number;
  medianTimeToReadyHours?: number | null;
  medianTimeToFirstReviewHours?: number | null;
  medianReviewToMergeHours?: number | null;
  medianCycleTimeHours?: number | null;
}

export interface StatsResponse {
  from: string;
  to: string;
  login: string; // GitHub login
  kpis: KPIs;
  timeseries: TimeseriesItem[];
  prs: PR[];
  tickets: JiraIssue[];
  warnings?: string[];

  lifecycle?: {
    items: PRLifecycle[];
    stats: LifecycleStats;
  };
}

/* ---------------- Sprint page types (/api/sprint-stats) ---------------- */

export interface JiraSprintLite {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed' | string;
  startDate?: string;
  endDate?: string;
}

export interface SprintKPI {
  // scope
  committedSP: number;
  scopeAddedSP: number;
  scopeRemovedSP: number;

  // ORIGINAL simple "completed" (kept for compatibility; equals Complete)
  completedSP: number;
  remainingSP: number;
  completionPct: number;

  // development progress (up to Reviewed)
  devCompletedSP: number;
  devRemainingSP: number;
  devCompletionPct: number;

  // complete progress (up to Approved/Done)
  completeCompletedSP: number;
  completeRemainingSP: number;
  completeCompletionPct: number;
}

export interface CompletedByAssignee {
  assignee: string;      // display name or "Unassigned"
  devPoints: number;     // tickets that reached Review (development complete)
  completePoints: number; // tickets that reached Approved/Done (dev+QA complete)
}

export interface SprintBurnItem {
  date: string;
  committed: number;

  // Actuals
  completed: number;
  remaining: number;
  devCompleted: number;
  devRemaining: number;
  completeCompleted: number;
  completeRemaining: number;

  // Forecast values (for future dates)
  devForecastCompleted?: number;
  devForecastRemaining?: number;
  completeForecastCompleted?: number;
  completeForecastRemaining?: number;
}

export interface SprintStatsResponse {
  sprintId: number;
  sprintName: string;
  startDate?: string;
  endDate?: string;

  kpis: SprintKPI;
  burn: SprintBurnItem[];
  issues: JiraIssue[];
  warnings?: string[];

  completedByAssignee?: CompletedByAssignee[];
  ticketsInQA?: number;

  forecast?: {
    devCompletionDate?: string;      // YYYY-MM-DD when dev (Review) hits scope
    completeCompletionDate?: string; // YYYY-MM-DD when complete (Approved/Done) hits scope
  };
}

/* ---------------- People / Projects dropdowns ---------------- */

export interface GithubUser {
  login: string;
  avatarUrl?: string;
  name?: string;
}

export interface JiraUserLite {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface UsersResponse {
  github: GithubUser[];
  jira: JiraUserLite[];
  warnings?: string[];
}

export interface JiraProjectLite {
  key: string;
  name: string;
}

export interface ProjectsResponse {
  projects: JiraProjectLite[];
  warnings?: string[];
}

/* --------- Linked PRs surfaced by Jira dev-status --------- */
export interface LinkedPR {
  id?: string;
  url: string;
  title?: string;
  source?: 'dev-status' | string;
}
