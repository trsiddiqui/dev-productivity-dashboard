import { NextResponse } from 'next/server';
import { getJiraProjects } from '../../../lib/jira';
import type { ProjectsResponse, JiraProjectLite } from '../../../lib/types';
import { requireAuthOr401 } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req); if (auth instanceof Response) return auth;
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
