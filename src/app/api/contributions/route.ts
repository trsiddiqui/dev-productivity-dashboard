import { NextResponse } from 'next/server';
import { DEV_BASE_BRANCH, getGithubPRsWithStats } from '@/lib/github';
import {
  aggregateContributionDaily,
  computeContributionKpis,
  summarizeRepoContributions,
} from '@/lib/contributions';
import type { ContributionResponse } from '@/lib/types';
import { requireAuthOr401 } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const login = searchParams.get('login') ?? '';
    const from = searchParams.get('from') ?? '';
    const to = searchParams.get('to') ?? '';
    const repo = (searchParams.get('repo') ?? '').trim() || undefined;
    const dateMode = searchParams.get('dateMode') === 'created' ? 'created' : 'merged';
    const mergedOnly = dateMode === 'merged'
      ? true
      : (searchParams.get('mergedOnly') ?? 'true') !== 'false';

    if (!login || !from || !to) {
      return NextResponse.json({ error: 'Missing required params: login, from, to' }, { status: 400 });
    }

    const prs = await getGithubPRsWithStats({
      login,
      from,
      to,
      repo,
      baseBranch: DEV_BASE_BRANCH,
      mergedOnly,
      dateField: dateMode,
    });

    const payload: ContributionResponse = {
      from,
      to,
      login,
      baseBranch: DEV_BASE_BRANCH,
      dateMode,
      mergedOnly,
      repo,
      kpis: computeContributionKpis({ from, to, prs, dateMode }),
      daily: aggregateContributionDaily({ from, to, prs, dateMode }),
      repos: summarizeRepoContributions(prs),
      prs,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
