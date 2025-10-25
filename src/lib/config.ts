export const cfg = {
  githubToken: process.env.GITHUB_TOKEN ?? '',
  githubOrg: process.env.GITHUB_ORG ?? '',
  githubRepos: (process.env.GITHUB_REPOS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  jiraBaseUrl: process.env.JIRA_BASE_URL ?? '',
  jiraEmail: process.env.JIRA_EMAIL ?? '',
  jiraToken: process.env.JIRA_API_TOKEN ?? '',
  jiraStoryPointsField: process.env.JIRA_STORY_POINTS_FIELD ?? 'customfield_10026',

  // NEW: Jira custom field id for "QA Assignee" (e.g., customfield_12345)
  jiraQAAssigneeField: process.env.JIRA_QA_ASSIGNEE_FIELD ?? 'customfield_11370',
};
