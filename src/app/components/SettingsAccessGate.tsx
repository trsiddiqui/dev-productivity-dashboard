'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { areRuntimeSettingsComplete } from '@/lib/runtime-settings';
import { useUserRuntimeSettings } from './runtime-settings-client';

function buildNextPath(pathname: string, searchParams: URLSearchParams): string {
  const search = searchParams.toString();
  return `${pathname}${search ? `?${search}` : ''}`;
}

export default function SettingsAccessGate(props: { username: string; children: ReactNode }) {
  const { username, children } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { settings, ready } = useUserRuntimeSettings(username);
  const settingsReady = areRuntimeSettingsComplete(settings);
  const onSettingsPage = pathname === '/settings';

  useEffect(() => {
    if (!username || !ready || settingsReady || onSettingsPage) return;
    const next = buildNextPath(pathname, new URLSearchParams(searchParams.toString()));
    router.replace(`/settings?next=${encodeURIComponent(next)}`);
  }, [onSettingsPage, pathname, ready, router, searchParams, settingsReady, username]);

  if (!username) return <>{children}</>;
  if (!ready) return null;
  if (!settingsReady && !onSettingsPage) return null;

  return <>{children}</>;
}
