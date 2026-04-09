export const RUNTIME_SETTINGS_COOKIE_NAME = 'dpd_runtime_settings';
export const RUNTIME_SETTINGS_STORAGE_PREFIX = 'dpd-runtime-settings';

export const DEFAULT_JIRA_BASE_URL = 'https://aligncommerce.atlassian.net';
export const DEFAULT_JIRA_STORY_POINTS_FIELD = 'customfield_11125';

export interface RuntimeSettingsFields {
  githubToken: string;
  githubOrg: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraToken: string;
  jiraStoryPointsField: string;
}

export interface StoredRuntimeSettings extends RuntimeSettingsFields {
  username: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getDefaultRuntimeSettingsFields(): RuntimeSettingsFields {
  return {
    githubToken: '',
    githubOrg: '',
    jiraBaseUrl: DEFAULT_JIRA_BASE_URL,
    jiraEmail: '',
    jiraToken: '',
    jiraStoryPointsField: DEFAULT_JIRA_STORY_POINTS_FIELD,
  };
}

export function normalizeRuntimeSettingsFields(
  value?: Partial<RuntimeSettingsFields> | null,
): RuntimeSettingsFields {
  const defaults = getDefaultRuntimeSettingsFields();
  return {
    githubToken: normalizeText(value?.githubToken) || defaults.githubToken,
    githubOrg: normalizeText(value?.githubOrg) || defaults.githubOrg,
    jiraBaseUrl: normalizeText(value?.jiraBaseUrl) || defaults.jiraBaseUrl,
    jiraEmail: normalizeText(value?.jiraEmail) || defaults.jiraEmail,
    jiraToken: normalizeText(value?.jiraToken) || defaults.jiraToken,
    jiraStoryPointsField: normalizeText(value?.jiraStoryPointsField) || defaults.jiraStoryPointsField,
  };
}

export function createStoredRuntimeSettings(
  username: string,
  value?: Partial<RuntimeSettingsFields> | null,
): StoredRuntimeSettings {
  return {
    username: normalizeText(username),
    ...normalizeRuntimeSettingsFields(value),
  };
}

export function buildRuntimeSettingsStorageKey(username: string): string {
  return `${RUNTIME_SETTINGS_STORAGE_PREFIX}:${normalizeText(username)}`;
}

export function serializeStoredRuntimeSettings(value: StoredRuntimeSettings): string {
  return encodeURIComponent(JSON.stringify(createStoredRuntimeSettings(value.username, value)));
}

export function parseStoredRuntimeSettings(raw?: string | null): StoredRuntimeSettings | null {
  if (!raw) return null;

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<StoredRuntimeSettings> | null;
    const username = normalizeText(parsed?.username);
    if (!username) return null;
    return createStoredRuntimeSettings(username, parsed);
  } catch {
    return null;
  }
}

export function areRuntimeSettingsComplete(value?: Partial<RuntimeSettingsFields> | null): boolean {
  const normalized = normalizeRuntimeSettingsFields(value);
  return [
    normalized.githubToken,
    normalized.githubOrg,
    normalized.jiraBaseUrl,
    normalized.jiraEmail,
    normalized.jiraToken,
    normalized.jiraStoryPointsField,
  ].every((field) => field.length > 0);
}

export function maskSecret(value: string, visibleEdge = 3): string {
  const trimmed = normalizeText(value);
  if (!trimmed) return 'Not set';
  const edge = Math.max(1, visibleEdge);
  if (trimmed.length <= edge * 2) {
    return `${trimmed.slice(0, edge)}${'*'.repeat(Math.max(4, trimmed.length))}`;
  }
  const head = trimmed.slice(0, edge);
  const tail = trimmed.slice(-edge);
  return `${head}${'*'.repeat(Math.max(8, trimmed.length - (edge * 2)))}${tail}`;
}
