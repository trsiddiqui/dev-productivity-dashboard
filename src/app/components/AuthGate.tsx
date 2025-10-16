'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';

export default function AuthGate({
  authed,
  children,
}: {
  authed: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || '/';

  // If not authed and not already on /login, jump to /login and show nothing.
  React.useEffect(() => {
    if (!authed && pathname !== '/') {
      const next = encodeURIComponent(pathname);
      router.replace(`/?next=${next}`);
    }
  }, [authed, pathname, router]);

  // Allow the login page to render even when unauthenticated.
  if (!authed && pathname !== '/') return null;

  return <>{children}</>;
}
