import { NextResponse } from 'next/server';
import { getJiraProjects } from '../../../lib/jira';
import type { ProjectsResponse, JiraProjectLite } from '../../../lib/types';
import { requireAuthOr401 } from '@/lib/auth';
import { withRequestRuntimeConfig } from '@/lib/config';
import { withCachedRouteResponse } from '@/lib/route-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getProjectsResponse(): Promise<Response> {
  const warnings: string[] = [];
  let projects: JiraProjectLite[] = [];
  try {
    projects = await getJiraProjects();
  } catch (e) {
    warnings.push(`JIRA projects unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const payload: ProjectsResponse = {
    projects,
    warnings: warnings.length ? warnings : undefined,
  };
  return NextResponse.json(payload);
}

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req); if (auth instanceof Response) return auth;
  return withRequestRuntimeConfig(req, auth, () => withCachedRouteResponse({
    req,
    authUser: auth,
    namespace: 'projects',
    handler: getProjectsResponse,
  }));
}
