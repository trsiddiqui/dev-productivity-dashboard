'use client';

import Link from 'next/link';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useState, type CSSProperties, type JSX } from 'react';
import { maskSecret } from '@/lib/runtime-settings';
import { useUserRuntimeSettings } from './runtime-settings-client';

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid var(--surface-border)',
  background: 'color-mix(in srgb, var(--surface) 84%, transparent)',
  color: 'var(--surface-link)',
  cursor: 'pointer',
};

const dialogCardStyle: CSSProperties = {
  width: 'min(560px, calc(100vw - 32px))',
  borderRadius: 18,
  border: '1px solid var(--panel-br)',
  background: 'var(--panel-bg)',
  color: 'var(--panel-fg)',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.45)',
  padding: 20,
};

const valueRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 180px) 1fr',
  gap: 12,
  padding: '10px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--panel-br) 76%, transparent)',
};

const valueCellStyle: CSSProperties = {
  minWidth: 0,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

export default function RuntimeSettingsStatus(props: { username: string }): JSX.Element | null {
  const { username } = props;
  const [open, setOpen] = useState(false);
  const { settings, configured, ready } = useUserRuntimeSettings(username);

  if (!username) return null;

  const jiraEmailLabel = settings.jiraEmail || 'Jira email not set';
  const gitHubTokenLabel = maskSecret(settings.githubToken);
  const jiraTokenLabel = maskSecret(settings.jiraToken);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={triggerStyle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Settings2 size={16} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.72 }}>
            Connection
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {ready && configured ? jiraEmailLabel : 'Using browser settings'}
          </span>
        </span>
        <ChevronDown size={16} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.68)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 40,
            padding: 16,
          }}
          onClick={() => setOpen(false)}
        >
          <div style={dialogCardStyle} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Configured Connections</div>
                <div style={{ color: 'var(--panel-muted)', fontSize: 14 }}>
                  Stored locally for <strong>{username}</strong>. Secrets are masked here.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  border: '1px solid var(--panel-br)',
                  background: 'var(--card-bg)',
                  color: 'var(--panel-fg)',
                  borderRadius: 10,
                  padding: '8px 10px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>

            <div style={{ borderTop: '1px solid color-mix(in srgb, var(--panel-br) 76%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--panel-br) 76%, transparent)', marginBottom: 16 }}>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>GitHub token</div>
                <div style={valueCellStyle}>{gitHubTokenLabel}</div>
              </div>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>GitHub organization</div>
                <div style={valueCellStyle}>{settings.githubOrg || 'Not set'}</div>
              </div>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>Jira base URL</div>
                <div style={valueCellStyle}>{settings.jiraBaseUrl || 'Not set'}</div>
              </div>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>Jira email</div>
                <div style={valueCellStyle}>{settings.jiraEmail || 'Not set'}</div>
              </div>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>Jira API token</div>
                <div style={valueCellStyle}>{jiraTokenLabel}</div>
              </div>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>Story points field</div>
                <div style={valueCellStyle}>{settings.jiraStoryPointsField || 'Not set'}</div>
              </div>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>TestRail base URL</div>
                <div style={valueCellStyle}>{settings.testRailBaseUrl || 'Not set'}</div>
              </div>
              <div style={valueRowStyle}>
                <div style={{ color: 'var(--panel-muted)' }}>TestRail email</div>
                <div style={valueCellStyle}>{settings.testRailEmail || 'Not set'}</div>
              </div>
              <div style={{ ...valueRowStyle, borderBottom: 'none' }}>
                <div style={{ color: 'var(--panel-muted)' }}>TestRail API token</div>
                <div style={valueCellStyle}>{maskSecret(settings.testRailToken)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ color: 'var(--panel-muted)', fontSize: 13 }}>
                {configured ? 'These values will be used on the next data fetch from this browser.' : 'No browser-specific settings saved yet.'}
              </div>
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--panel-br)',
                  background: 'var(--card-bg)',
                  color: 'var(--panel-fg)',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                Open settings
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
