

export interface PR {
  id: string;
  number: number;
  title: string;
  url: string;
  // Source branch name for the PR
  headRefName?: string;

  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;

  additions: number;
  deletions: number;
  repository: { owner: string; name: string };


  firstReviewAt?: string | null;
  readyForReviewAt?: string | null;

  jiraKeys?: string[];
}


export interface LinkedPR {
  id?: string;
  url: string;
  title?: string;
  source?: 'dev-status' | 'commit-msg' | 'custom';
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


  created?: string;
  updated?: string;
  issueType?: string;
  parentKey?: string;
  epicKey?: string;


  description?: string;


  qaAssignees?: Array<{ id?: string; name: string }>;

  qaAssignedAtMap?: Record<string, string | undefined>;

  qaReviewToCompleteHoursByQA?: Record<string, number | null>;


  todoAt?: string;
  inProgressAt?: string;
  reviewAt?: string;
  completeAt?: string;


  inProgressToReviewHours?: number | null;
  reviewToCompleteHours?: number | null;


  todoToReviewHours?: number | null;


  linkedPRs?: LinkedPR[];
  prAdditions?: number;
  prDeletions?: number;
  prReviewComments?: number;

  // True if, within selected window, the selected Jira user authored any changelog entry on this ticket
  updatedBySelectedUserInWindow?: boolean;
}

export interface KPIs {
  totalPRs: number;
  totalTicketsDone: number;
  totalStoryPoints: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface TimeseriesItem {
  date: string;
  prCount: number;
  additions: number;
  deletions: number;
  tickets: number;
  storyPoints: number;
}



export interface PRLifecycle {
  id: string;
  number: number;
  title: string;
  url: string;
  // Source branch name (for subtitle in PR column)
  headRefName?: string;
  createdAt: string;
  // When linked Jira ticket moved from To Do to In Progress
  workStartedAt?: string | null;
  // Linked Jira ticket metadata (primary association)
  jiraKey?: string;
  jiraSummary?: string;
  jiraUrl?: string;
  readyForReviewAt?: string | null;
  firstReviewAt?: string | null;
  mergedAt?: string | null;
  closedAt?: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;


  additions?: number;
  deletions?: number;


  timeToReadyHours?: number | null;
  timeToFirstReviewHours?: number | null;
  reviewToMergeHours?: number | null;
  cycleTimeHours?: number | null;
  // Difference between Work Started (Jira In Progress) and PR Created
  inProgressToCreatedHours?: number | null;
}

export interface LifecycleStats {
  sampleSize: number;
  medianTimeToReadyHours?: number | null;
  medianTimeToFirstReviewHours?: number | null;
  medianReviewToMergeHours?: number | null;
  medianCycleTimeHours?: number | null;
  medianInProgressToCreatedHours?: number | null;
}

export interface StatsResponse {
  from: string;
  to: string;
  login: string;
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



export interface JiraSprintLite {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed' | string;
  startDate?: string;
  endDate?: string;
}

export interface SprintKPI {

  committedSP: number;
  scopeAddedSP: number;
  scopeRemovedSP: number;


  completedSP: number;
  remainingSP: number;
  completionPct: number;


  devCompletedSP: number;
  devRemainingSP: number;
  devCompletionPct: number;


  completeCompletedSP: number;
  completeRemainingSP: number;
  completeCompletionPct: number;


  totalPRAdditions?: number;
  totalPRDeletions?: number;
}

export interface CompletedByAssignee {
  assignee: string;
  devPoints: number;
  completePoints: number;
}

export interface SprintBurnItem {
  date: string;
  committed: number;


  completed: number;
  remaining: number;
  devCompleted: number;
  devRemaining: number;
  completeCompleted: number;
  completeRemaining: number;


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
  
  qaActivity?: Record<string, QAActivityEvent[]>;

  forecast?: {
    devCompletionDate?: string;
    completeCompletionDate?: string;
  };
}


export interface QAActivityEvent {
  at: string; // ISO
  type: 'comment' | 'status';
  issueKey: string;
}


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