
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'dpd_auth';
const SECRET = process.env.AUTH_SECRET || 'dev-change-me';


async function verifyToken(token?: string | null): Promise<boolean> {
  if (!token) return false;
  const idx = token.lastIndexOf('|');
  if (idx < 1) return false;
  const username = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(username));
  const bytes = new Uint8Array(mac);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === sig;
}

const PUBLIC_PATHS = new Set([
  '/',
  '/api/auth/login',
  '/api/auth/logout',
  '/favicon.ico',
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/assets') || pathname.startsWith('/images')) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = await verifyToken(token);


  if (pathname.startsWith('/api/')) {
    if (!ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }


  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }


  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
