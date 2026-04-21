import { NextResponse } from 'next/server';
import { requireAuthOr401 } from '@/lib/auth';
import { withRequestRuntimeConfig } from '@/lib/config';
import { computeManagementOverview } from '@/lib/management';
import { withCachedRouteResponse } from '@/lib/route-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getManagementOverviewResponse(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from')?.trim() ?? '';
  const to = searchParams.get('to')?.trim() ?? '';
  const projectIdRaw = searchParams.get('projectId')?.trim() ?? '';
  const projectId = projectIdRaw ? Number(projectIdRaw) : null;

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing required params: from, to' }, { status: 400 });
  }
  if (projectIdRaw && !Number.isFinite(projectId)) {
    return NextResponse.json({ error: 'projectId must be a number when provided' }, { status: 400 });
  }

  try {
    const payload = await computeManagementOverview({
      from,
      to,
      projectId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build management overview';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req);
  if (auth instanceof Response) return auth;

  return withRequestRuntimeConfig(req, auth, () => withCachedRouteResponse({
    req,
    authUser: auth,
    namespace: 'management-overview',
    handler: () => getManagementOverviewResponse(req),
  }));
}
