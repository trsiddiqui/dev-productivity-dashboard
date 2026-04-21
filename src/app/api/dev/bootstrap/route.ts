import { NextResponse } from 'next/server';
import { loadAccounts, setSessionCookie } from '@/lib/auth';
import {
  createStoredRuntimeSettings,
  serializeStoredRuntimeSettings,
  type RuntimeSettingsFields,
} from '@/lib/runtime-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeForHtmlScript(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function getBootstrapUser(): string | null {
  const accounts = loadAccounts();
  const users = Object.keys(accounts);
  return users[0] ?? null;
}

function getBootstrapSettings(): RuntimeSettingsFields {
  return {
    githubToken: process.env.GITHUB_TOKEN ?? '',
    githubOrg: process.env.GITHUB_ORG ?? '',
    jiraBaseUrl: process.env.JIRA_BASE_URL ?? '',
    jiraEmail: process.env.JIRA_EMAIL ?? '',
    jiraToken: process.env.JIRA_API_TOKEN ?? '',
    jiraStoryPointsField: process.env.JIRA_STORY_POINTS_FIELD ?? 'customfield_11125',
    jiraQAAssigneeField: process.env.JIRA_QA_ASSIGNEE_FIELD ?? 'customfield_11370',
    testRailBaseUrl: process.env.TESTRAIL_BASE_URL ?? '',
    testRailEmail: process.env.TESTRAIL_EMAIL ?? '',
    testRailToken: process.env.TESTRAIL_API_TOKEN ?? '',
  };
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const username = getBootstrapUser();
  if (!username) {
    return NextResponse.json({ error: 'No local bootstrap user is configured.' }, { status: 500 });
  }

  const settings = getBootstrapSettings();
  const serializedSettings = serializeStoredRuntimeSettings(
    createStoredRuntimeSettings(username, settings),
  );
  const storageKey = `dpd-runtime-settings:${username}`;
  const payload = escapeForHtmlScript(JSON.stringify(settings));
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Bootstrapping dashboard</title>
  </head>
  <body style="font-family: sans-serif; padding: 24px;">
    <p>Signing in and loading local credentials...</p>
    <script>
      try {
        const settings = JSON.parse(\`${payload}\`);
        localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(settings));
        document.cookie = 'dpd_runtime_settings=${serializedSettings}; Path=/; Max-Age=31536000; SameSite=Lax';
      } catch (error) {
        console.error(error);
      }
      window.location.replace('/management');
    </script>
  </body>
</html>`;

  const response = new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
  await setSessionCookie(response, username);
  return response;
}
