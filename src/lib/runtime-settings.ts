export const RUNTIME_SETTINGS_COOKIE_NAME = 'dpd_runtime_settings';
export const RUNTIME_QA_SETTINGS_COOKIE_NAME = 'dpd_runtime_settings_qa';
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
  testRailBaseUrl: string;
  testRailEmail: string;
  testRailToken: string;
}

export interface StoredRuntimeSettings extends RuntimeSettingsFields {
  username: string;
}

export interface StoredCoreRuntimeSettings {
  username: string;
  githubToken: string;
  githubOrg: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraToken: string;
  jiraStoryPointsField: string;
}

export interface StoredQaRuntimeSettings {
  username: string;
  testRailBaseUrl: string;
  testRailEmail: string;
  testRailToken: string;
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
    testRailBaseUrl: '',
    testRailEmail: '',
    testRailToken: '',
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
    testRailBaseUrl: normalizeText(value?.testRailBaseUrl) || defaults.testRailBaseUrl,
    testRailEmail: normalizeText(value?.testRailEmail) || defaults.testRailEmail,
    testRailToken: normalizeText(value?.testRailToken) || defaults.testRailToken,
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

export function createStoredCoreRuntimeSettings(
  username: string,
  value?: Partial<RuntimeSettingsFields> | null,
): StoredCoreRuntimeSettings {
  const normalized = normalizeRuntimeSettingsFields(value);
  return {
    username: normalizeText(username),
    githubToken: normalized.githubToken,
    githubOrg: normalized.githubOrg,
    jiraBaseUrl: normalized.jiraBaseUrl,
    jiraEmail: normalized.jiraEmail,
    jiraToken: normalized.jiraToken,
    jiraStoryPointsField: normalized.jiraStoryPointsField,
  };
}

export function createStoredQaRuntimeSettings(
  username: string,
  value?: Partial<RuntimeSettingsFields> | null,
): StoredQaRuntimeSettings {
  const normalized = normalizeRuntimeSettingsFields(value);
  return {
    username: normalizeText(username),
    testRailBaseUrl: normalized.testRailBaseUrl,
    testRailEmail: normalized.testRailEmail,
    testRailToken: normalized.testRailToken,
  };
}

export function buildRuntimeSettingsStorageKey(username: string): string {
  return `${RUNTIME_SETTINGS_STORAGE_PREFIX}:${normalizeText(username)}`;
}

export function serializeStoredRuntimeSettings(value: StoredRuntimeSettings): string {
  return encodeURIComponent(JSON.stringify(createStoredRuntimeSettings(value.username, value)));
}

export function serializeStoredCoreRuntimeSettings(value: StoredCoreRuntimeSettings): string {
  return encodeURIComponent(JSON.stringify(createStoredCoreRuntimeSettings(value.username, value)));
}

export function serializeStoredQaRuntimeSettings(value: StoredQaRuntimeSettings): string {
  return encodeURIComponent(JSON.stringify(createStoredQaRuntimeSettings(value.username, value)));
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

export function parseStoredCoreRuntimeSettings(raw?: string | null): StoredCoreRuntimeSettings | null {
  if (!raw) return null;

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<StoredCoreRuntimeSettings> | null;
    const username = normalizeText(parsed?.username);
    if (!username) return null;
    return createStoredCoreRuntimeSettings(username, parsed);
  } catch {
    return null;
  }
}

export function parseStoredQaRuntimeSettings(raw?: string | null): StoredQaRuntimeSettings | null {
  if (!raw) return null;

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<StoredQaRuntimeSettings> | null;
    const username = normalizeText(parsed?.username);
    if (!username) return null;
    return createStoredQaRuntimeSettings(username, parsed);
  } catch {
    return null;
  }
}

export function areCoreRuntimeSettingsComplete(value?: Partial<RuntimeSettingsFields> | null): boolean {
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

export function areTestRailRuntimeSettingsComplete(value?: Partial<RuntimeSettingsFields> | null): boolean {
  const normalized = normalizeRuntimeSettingsFields(value);
  return [
    normalized.testRailBaseUrl,
    normalized.testRailEmail,
    normalized.testRailToken,
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
