
import { NextRequest } from 'next/server';
import { requireAuthOr401 } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function GET(req: NextRequest) {

  const auth = await requireAuthOr401(req as unknown as Request);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const sprintId = url.searchParams.get('sprintId');
  if (!sprintId) return new Response('Missing sprintId', { status: 400 });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const write = (obj: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const progress = (pct: number, label: string) => write({ type: 'progress', pct: Math.max(0, Math.min(100, Math.round(pct))), label });


  const apiUrl = `${url.origin}/api/sprint-stats?sprintId=${encodeURIComponent(sprintId)}`;


  (async () => {
    try {


      const stages = [
        'Fetching sprint details',
        'Fetching sprint issues',
        'Analyzing ticket history',
        'Fetching PRs & LOC',
        'Computing KPIs & burn',
      ];

      let pct = 0;
      let stageIdx = 0;
      progress(1, 'Starting…');

      const tick = () => {
        if (pct >= 95) return;
        pct = Math.min(95, pct + 2);
        if (pct >= ((stageIdx + 1) * 95) / stages.length && stageIdx < stages.length - 1) stageIdx += 1;
        progress(pct, stages[stageIdx]);
      };

      const timer = setInterval(tick, 700);


      const resp = await fetch(apiUrl, {
        headers: { cookie: req.headers.get('cookie') ?? '' },
      });

      clearInterval(timer);

      if (!resp.ok) {
        const text = await resp.text();
        write({ type: 'error', message: text || `Upstream error (${resp.status})` });
        await writer.close();
        return;
      }

      const json = await resp.json();
      progress(100, 'Done');
      write({ type: 'done', result: json });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      write({ type: 'error', message });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}