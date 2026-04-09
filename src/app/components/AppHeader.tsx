'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import LogoutButton from './LogoutButton';
import RuntimeSettingsStatus from './RuntimeSettingsStatus';
import ThemeSelect from './ThemeSelect';

const NAV_ITEMS = [
  { href: '/individual', label: 'Individual' },
  { href: '/contributions', label: 'Contributions' },
  { href: '/sprint', label: 'Sprint' },
  { href: '/qa', label: 'QA' },
  { href: '/settings', label: 'Settings' },
];

function BrandMark(): JSX.Element {
  return (
    <span className="app-brand-mark" aria-hidden="true">
      <span className="app-brand-mark__grid" />
      <span className="app-brand-mark__bar app-brand-mark__bar--one" />
      <span className="app-brand-mark__bar app-brand-mark__bar--two" />
      <span className="app-brand-mark__bar app-brand-mark__bar--three" />
      <span className="app-brand-mark__pulse" />
    </span>
  );
}

export default function AppHeader(props: { username: string }): JSX.Element {
  const { username } = props;
  const pathname = usePathname();

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Link href="/individual" className="app-brand">
          <BrandMark />
          <span className="app-brand-copy">
            <span className="app-brand-copy__eyebrow">Operations Intelligence</span>
            <span className="app-brand-copy__name">Dev Productivity Dashboard</span>
          </span>
        </Link>

        <nav className="app-primary-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`app-primary-nav__link${active ? ' is-active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="app-header__actions">
          <RuntimeSettingsStatus username={username} />
          <LogoutButton />
          <ThemeSelect />
        </div>
      </div>
    </header>
  );
}
