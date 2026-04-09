import { NextResponse } from 'next/server';
import { requireAuthOr401 } from '@/lib/auth';
import { withRequestRuntimeConfig } from '@/lib/config';
import { withCachedRouteResponse } from '@/lib/route-cache';
import { getGithubOrgMembers } from '@/lib/github';
import { getTestRailProjects, getTestRailStatuses, getTestRailUsers } from '@/lib/testrail';
import type { GithubUser } from '@/lib/types';
import type { QaCatalogResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getQaCatalogResponse(req: Request): Promise<Response> {
  const warnings: string[] = [];
  const { searchParams } = new URL(req.url);
  const projectIdParam = searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : undefined;

  try {
    const [projects, statuses, users] = await Promise.all([
      getTestRailProjects(),
      getTestRailStatuses(),
      projectId && Number.isFinite(projectId) ? getTestRailUsers(projectId) : Promise.resolve([]),
    ]);

    let githubUsers: GithubUser[] = [];
    try {
      githubUsers = await getGithubOrgMembers();
    } catch (error) {
      warnings.push(`GitHub users unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const payload: QaCatalogResponse = {
      projects,
      users,
      githubUsers,
      statuses,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch TestRail catalog';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req);
  if (auth instanceof Response) return auth;

  return withRequestRuntimeConfig(req, auth, () => withCachedRouteResponse({
    req,
    authUser: auth,
    namespace: 'qa-catalog',
    handler: () => getQaCatalogResponse(req),
  }));
}
