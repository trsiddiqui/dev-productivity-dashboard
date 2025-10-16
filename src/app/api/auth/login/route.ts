// src/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import { setSessionCookie, verifyCredentials } from '@/lib/auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { username, password } = (await req.json()) as { username?: string; password?: string };
    if (!username || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }
    if (!verifyCredentials(username, password)) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true, user: username });
    await setSessionCookie(res, username);
    return res;
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
