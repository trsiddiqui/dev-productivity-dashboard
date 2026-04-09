import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyToken } from '@/lib/auth';
import SettingsPageClient from './SettingsPageClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const token = (await cookies()).get(COOKIE_NAME)?.value ?? null;
  const username = await verifyToken(token);

  return <SettingsPageClient username={username ?? ''} />;
}
