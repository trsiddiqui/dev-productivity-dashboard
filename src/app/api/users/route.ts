import { NextResponse } from 'next/server';
import { getGithubOrgMembers } from '../../../lib/github';
import { getJiraUsers } from '../../../lib/jira';
import type {
  UsersResponse,
  GithubUser,
  JiraUserLite,
} from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const warnings: string[] = [];

  // ✅ annotate the arrays so they aren't implicitly `any[]`
  let github: GithubUser[] = [];
  let jira: JiraUserLite[] = [];

  try {
    github = await getGithubOrgMembers();
  } catch (e: unknown) {
    warnings.push(
      `GitHub users unavailable: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  try {
    jira = await getJiraUsers();
  } catch (e: unknown) {
    warnings.push(
      `JIRA users unavailable: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const payload: UsersResponse = {
    github,
    jira,
    warnings: warnings.length ? warnings : undefined,
  };

  return NextResponse.json(payload);
}
