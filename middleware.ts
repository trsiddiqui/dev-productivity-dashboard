
import { NextRequest, NextResponse } from 'next/server';
import {
  areCoreRuntimeSettingsComplete,
  parseStoredRuntimeSettings,
  RUNTIME_SETTINGS_COOKIE_NAME,
} from './src/lib/runtime-settings';

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
  '/api/auth/login',
  '/api/auth/logout',
  '/favicon.ico',
]);

function buildSettingsRedirect(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  const nextTarget = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  url.pathname = '/settings';
  url.searchParams.set('next', nextTarget);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/assets') || pathname.startsWith('/images')) {
    return NextResponse.next();
  }
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const runtimeSettingsCookie = req.cookies.get(RUNTIME_SETTINGS_COOKIE_NAME)?.value ?? null;
  const ok = await verifyToken(token);
  const username = ok && token ? token.slice(0, token.lastIndexOf('|')) : null;
  const storedSettings = parseStoredRuntimeSettings(runtimeSettingsCookie);
  const settingsReady = !!username
    && !!storedSettings
    && storedSettings.username === username
    && areCoreRuntimeSettingsComplete(storedSettings);

  if (pathname === '/') {
    if (!ok) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = settingsReady ? '/individual' : '/settings';
    return NextResponse.redirect(url);
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();


  if (pathname.startsWith('/api/')) {
    if (!ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!settingsReady) {
      return NextResponse.json(
        {
          error: 'Settings required',
          message: 'Complete the connection settings before using dashboard APIs.',
        },
        { status: 428 },
      );
    }
    return NextResponse.next();
  }


  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (!settingsReady && pathname !== '/settings') {
    return buildSettingsRedirect(req);
  }


  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
