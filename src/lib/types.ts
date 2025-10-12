export interface PR {
  id: string;
  number: number;
  title: string;
  url: string;

  // NEW fields
  createdAt: string;       // ISO
  mergedAt: string | null; // ISO or null
  closedAt: string | null; // ISO or null
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;

  additions: number;
  deletions: number;
  repository: { owner: string; name: string };

  // NEW: extra timestamps used for lifecycle calculations
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

export interface StatsResponse {
  from: string;
  to: string;
  login: string;             // GitHub login
  kpis: KPIs;
  timeseries: TimeseriesItem[];
  prs: PR[];
  tickets: JiraIssue[];
  warnings?: string[];
}

/** New: user lists */
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
// --- NEW ---
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

// extend API payload
export interface StatsResponse {
  from: string;
  to: string;
  login: string;
  kpis: KPIs;
  timeseries: TimeseriesItem[];
  prs: PR[];
  tickets: JiraIssue[];
  warnings?: string[];

  // NEW
  lifecycle?: {
    items: PRLifecycle[];
    stats: LifecycleStats;
  };
}