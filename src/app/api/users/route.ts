import { NextResponse } from 'next/server';
import { getGithubOrgMembers } from '../../../lib/github';
import { getJiraUsers } from '../../../lib/jira';
import type {
  UsersResponse,
  GithubUser,
  JiraUserLite,
} from '../../../lib/types';
import { requireAuthOr401 } from '@/lib/auth';
import { withCachedRouteResponse } from '@/lib/route-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getUsersResponse(): Promise<Response> {
  const warnings: string[] = [];

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

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req); if (auth instanceof Response) return auth;
  return withCachedRouteResponse({
    req,
    authUser: auth,
    namespace: 'users',
    handler: getUsersResponse,
  });
}
