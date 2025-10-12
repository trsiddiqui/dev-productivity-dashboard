import { NextResponse } from 'next/server';
import { getJiraSprints } from '../../../lib/jira';
import { JiraSprintLite } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sprints?boardId=123
 * If boardId is missing, tries env JIRA_BOARD_ID.
 */
export async function GET(req: Request) {
  const warnings: string[] = [];
  try {
    const { searchParams } = new URL(req.url);
    const boardIdParam = searchParams.get('boardId');
    const envBoard = process.env.JIRA_BOARD_ID ? Number(process.env.JIRA_BOARD_ID) : undefined;
    const boardId = boardIdParam ? Number(boardIdParam) : envBoard;

    if (!boardId || Number.isNaN(boardId)) {
      return NextResponse.json({ sprints: [], warnings: ['Missing boardId (query param or JIRA_BOARD_ID env).'] });
    }

    const sprints = await getJiraSprints(boardId);
    const pickTime = (s: JiraSprintLite) => {
    const end = s.endDate ? Date.parse(s.endDate) : NaN;
    const start = s.startDate ? Date.parse(s.startDate) : NaN;
    if (Number.isFinite(end)) return end;
    if (Number.isFinite(start)) return start;
        return -Infinity;
    };
    sprints.sort((a, b) => pickTime(b) - pickTime(a));
    return NextResponse.json({ sprints, warnings: warnings.length ? warnings : undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ sprints: [], warnings: [`Failed to fetch sprints: ${msg}`] });
  }
}
