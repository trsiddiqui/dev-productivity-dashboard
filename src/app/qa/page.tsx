import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyToken } from '@/lib/auth';
import QaPageClient from './QaPageClient';

export const dynamic = 'force-dynamic';

export default async function QaPage() {
  const token = (await cookies()).get(COOKIE_NAME)?.value ?? null;
  const username = await verifyToken(token);

  return <QaPageClient username={username ?? ''} />;
}
