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


  React.useEffect(() => {
    if (!authed && pathname !== '/') {
      const next = encodeURIComponent(pathname);
      router.replace(`/?next=${next}`);
    }
  }, [authed, pathname, router]);


  if (!authed && pathname !== '/') return null;

  return <>{children}</>;
}
