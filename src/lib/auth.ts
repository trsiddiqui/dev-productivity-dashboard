
import { NextResponse } from 'next/server';

export const COOKIE_NAME = 'dpd_auth';
const SECRET = process.env.AUTH_SECRET || 'dev-change-me';


export function loadAccounts(): Record<string, string> {
  const raw = process.env.USER_ACCOUNTS || '';
  const map: Record<string, string> = {};
  raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(pair => {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const u = pair.slice(0, idx).trim();
        const p = pair.slice(idx + 1).trim();
        if (u && p) map[u] = p;
      }
    });
  return map;
}

export function verifyCredentials(username: string, password: string): boolean {
  const accounts = loadAccounts();
  return !!accounts[username] && accounts[username] === password;
}


async function hmac(input: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(input));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}


export async function signToken(username: string): Promise<string> {
  const sig = await hmac(username);
  return `${username}|${sig}`;
}

export async function verifyToken(token?: string | null): Promise<string | null> {
  if (!token) return null;
  const idx = token.lastIndexOf('|');
  if (idx < 1) return null;
  const username = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expect = await hmac(username);
  return sig === expect ? username : null;
}


export async function setSessionCookie(res: NextResponse, username: string) {
  const token = await signToken(username);
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}


export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
}


export async function userFromRequest(req: Request): Promise<string | null> {
  const cookie = req.headers.get('cookie') || '';
  const part = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  if (!part) return null;
  const token = decodeURIComponent(part.split('=')[1] || '');
  return verifyToken(token);
}


export async function requireAuthOr401(req: Request): Promise<string | Response> {
  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return user;
}
