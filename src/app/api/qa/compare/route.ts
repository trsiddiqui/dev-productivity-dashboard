import { NextResponse } from 'next/server';
import { requireAuthOr401 } from '@/lib/auth';
import { withRequestRuntimeConfig } from '@/lib/config';
import { withCachedRouteResponse } from '@/lib/route-cache';
import { computeQaComparison } from '@/lib/qa';
import { getTestRailProjects, getTestRailStatuses, getTestRailUsers } from '@/lib/testrail';
import type { QaCompareResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getQaCompareResponse(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const projectId = Number(searchParams.get('projectId') ?? '');
  const leftUserId = Number(searchParams.get('leftUserId') ?? '');
  const rightUserId = Number(searchParams.get('rightUserId') ?? '');
  const leftGithubLogin = searchParams.get('leftGithubLogin')?.trim() || null;
  const rightGithubLogin = searchParams.get('rightGithubLogin')?.trim() || null;

  if (!from || !to || !Number.isFinite(projectId) || !Number.isFinite(leftUserId) || !Number.isFinite(rightUserId)) {
    return NextResponse.json({ error: 'Missing required params: from, to, projectId, leftUserId, rightUserId' }, { status: 400 });
  }

  try {
    const [projects, statuses, users] = await Promise.all([
      getTestRailProjects(),
      getTestRailStatuses(),
      getTestRailUsers(projectId),
    ]);

    const leftUser = users.find((user) => user.id === leftUserId);
    const rightUser = users.find((user) => user.id === rightUserId);
    if (!leftUser || !rightUser) {
      return NextResponse.json({ error: 'Selected TestRail users were not found in this project.' }, { status: 400 });
    }

    const comparison = await computeQaComparison({
      projectId,
      from,
      to,
      leftUser,
      rightUser,
      statuses,
      leftGithubLogin,
      rightGithubLogin,
    });

    const payload: QaCompareResponse = {
      from,
      to,
      projectId,
      projectName: projects.find((project) => project.id === projectId)?.name,
      left: comparison.left,
      right: comparison.right,
      daily: comparison.daily,
      statusBreakdown: comparison.statusBreakdown,
      metricDefinitions: comparison.metricDefinitions,
      warnings: comparison.warnings,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compare QA resources';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req);
  if (auth instanceof Response) return auth;

  return withRequestRuntimeConfig(req, auth, () => withCachedRouteResponse({
    req,
    authUser: auth,
    namespace: 'qa-compare',
    handler: () => getQaCompareResponse(req),
  }));
}
