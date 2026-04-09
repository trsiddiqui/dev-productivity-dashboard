import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  getDefaultRuntimeSettingsFields,
  parseStoredRuntimeSettings,
  RUNTIME_SETTINGS_COOKIE_NAME,
  type RuntimeSettingsFields,
} from './runtime-settings';

export interface RuntimeConfig extends RuntimeSettingsFields {
  githubRepos: string[];
  jiraQAAssigneeField: string;
}

const runtimeConfigStore = new AsyncLocalStorage<RuntimeConfig>();

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const parts = cookieHeader.split(';').map((part) => part.trim());
  const prefix = `${name}=`;
  const match = parts.find((part) => part.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function resolveEnvConfig(): RuntimeConfig {
  return {
    githubToken: process.env.GITHUB_TOKEN ?? '',
    githubOrg: process.env.GITHUB_ORG ?? '',
    githubRepos: splitCsv(process.env.GITHUB_REPOS),
    jiraBaseUrl: process.env.JIRA_BASE_URL ?? '',
    jiraEmail: process.env.JIRA_EMAIL ?? '',
    jiraToken: process.env.JIRA_API_TOKEN ?? '',
    jiraStoryPointsField: process.env.JIRA_STORY_POINTS_FIELD ?? 'customfield_10026',
    jiraQAAssigneeField: process.env.JIRA_QA_ASSIGNEE_FIELD ?? 'customfield_11370',
  };
}

const envConfig = resolveEnvConfig();

function resolveIncompleteRuntimeConfig(): RuntimeConfig {
  const defaults = getDefaultRuntimeSettingsFields();
  return {
    ...envConfig,
    githubToken: '',
    githubOrg: '',
    jiraBaseUrl: defaults.jiraBaseUrl,
    jiraEmail: '',
    jiraToken: '',
    jiraStoryPointsField: defaults.jiraStoryPointsField,
  };
}

function resolveRuntimeConfigFromStoredSettings(): RuntimeConfig {
  return envConfig;
}

export function resolveRuntimeConfigForRequest(req: Request, authUser: string): RuntimeConfig {
  const raw = readCookie(req, RUNTIME_SETTINGS_COOKIE_NAME);
  const stored = parseStoredRuntimeSettings(raw);
  if (!stored || stored.username !== authUser) {
    return resolveIncompleteRuntimeConfig();
  }

  return {
    ...envConfig,
    githubToken: stored.githubToken,
    githubOrg: stored.githubOrg,
    jiraBaseUrl: stored.jiraBaseUrl,
    jiraEmail: stored.jiraEmail,
    jiraToken: stored.jiraToken,
    jiraStoryPointsField: stored.jiraStoryPointsField,
  };
}

export function getRuntimeSettingsFingerprintForRequest(req: Request, authUser: string): string {
  const config = resolveRuntimeConfigForRequest(req, authUser);
  const hash = createHash('sha256')
    .update(JSON.stringify({
      ...config,
      githubRepos: [...config.githubRepos].sort(),
    }))
    .digest('hex');
  return hash.slice(0, 16);
}

export function withRequestRuntimeConfig<T>(
  req: Request,
  authUser: string,
  handler: () => Promise<T>,
): Promise<T> {
  const config = resolveRuntimeConfigForRequest(req, authUser);
  return runtimeConfigStore.run(config, handler);
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfigStore.getStore() ?? resolveRuntimeConfigFromStoredSettings();
}

export const cfg = Object.freeze({
  get githubToken(): string {
    return getRuntimeConfig().githubToken;
  },
  get githubOrg(): string {
    return getRuntimeConfig().githubOrg;
  },
  get githubRepos(): string[] {
    return getRuntimeConfig().githubRepos;
  },
  get jiraBaseUrl(): string {
    return getRuntimeConfig().jiraBaseUrl;
  },
  get jiraEmail(): string {
    return getRuntimeConfig().jiraEmail;
  },
  get jiraToken(): string {
    return getRuntimeConfig().jiraToken;
  },
  get jiraStoryPointsField(): string {
    return getRuntimeConfig().jiraStoryPointsField;
  },
  get jiraQAAssigneeField(): string {
    return getRuntimeConfig().jiraQAAssigneeField;
  },
}) as RuntimeConfig;
