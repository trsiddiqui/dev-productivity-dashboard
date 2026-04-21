import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyToken } from '@/lib/auth';
import ManagementPageClient from './ManagementPageClient';

export const dynamic = 'force-dynamic';

export default async function ManagementPage() {
  const token = (await cookies()).get(COOKIE_NAME)?.value ?? null;
  const username = await verifyToken(token);

  return <ManagementPageClient username={username ?? ''} />;
}
