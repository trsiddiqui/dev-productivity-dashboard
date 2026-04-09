'use client';

import { useEffect, useState, type CSSProperties, type FormEvent, type JSX } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  areCoreRuntimeSettingsComplete,
  areTestRailRuntimeSettingsComplete,
  getDefaultRuntimeSettingsFields,
  type RuntimeSettingsFields,
} from '@/lib/runtime-settings';
import { useUserRuntimeSettings } from '../components/runtime-settings-client';

const panelStyle: CSSProperties = {
  background: 'var(--panel-bg)',
  color: 'var(--panel-fg)',
  border: '1px solid var(--panel-br)',
  borderRadius: 18,
  padding: 24,
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--panel-br)',
  background: 'var(--card-bg)',
  color: 'var(--card-fg)',
};

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  help?: string;
}): JSX.Element {
  const { label, value, onChange, placeholder, type = 'text', help } = props;
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
      {help && <div style={{ marginTop: 6, color: 'var(--panel-muted)', fontSize: 12 }}>{help}</div>}
    </div>
  );
}

export default function SettingsPageClient(props: { username: string }): JSX.Element {
  const { username } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings, configured, ready, save } = useUserRuntimeSettings(username);
  const [form, setForm] = useState<RuntimeSettingsFields>(getDefaultRuntimeSettingsFields());
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const rawNextPath = searchParams.get('next');
  const nextPath = rawNextPath && rawNextPath.startsWith('/') && !rawNextPath.startsWith('//')
    ? rawNextPath
    : null;
  const coreSettingsComplete = areCoreRuntimeSettingsComplete(form);
  const storedCoreSettingsComplete = areCoreRuntimeSettingsComplete(settings);
  const testRailSettingsComplete = areTestRailRuntimeSettingsComplete(form);

  useEffect(() => {
    if (!ready) return;
    setForm(settings);
  }, [ready, settings]);

  useEffect(() => {
    if (!ready || !nextPath || !configured || !storedCoreSettingsComplete) return;
    router.replace(nextPath);
  }, [configured, nextPath, ready, router, storedCoreSettingsComplete]);

  function updateField<K extends keyof RuntimeSettingsFields>(key: K, value: RuntimeSettingsFields[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveMessage(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = save(form);
    setForm(normalized);
    if (areCoreRuntimeSettingsComplete(normalized) && nextPath) {
      router.replace(nextPath);
      return;
    }
    setSaveMessage('Settings saved in this browser.');
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: 24, display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>
          Settings
        </div>
        <h1 style={{ fontSize: 34, lineHeight: 1.1, fontWeight: 700 }}>Connection settings</h1>
        <p style={{ maxWidth: 720, color: 'var(--panel-muted)', fontSize: 15, lineHeight: 1.6 }}>
          Save GitHub and Jira credentials per signed-in dashboard user. These values stay in this browser and are reused automatically the next time <strong>{username}</strong> logs in here.
        </p>
      </div>

      <div style={{ ...panelStyle, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Configured for {username}</div>
            <div style={{ color: 'var(--panel-muted)', fontSize: 14 }}>
              {storedCoreSettingsComplete ? 'Core browser-specific values are active for this user.' : 'Complete the GitHub and Jira fields to unlock the rest of the dashboard.'}
            </div>
          </div>
          {saveMessage && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 999,
              background: 'color-mix(in srgb, #22c55e 16%, transparent)',
              border: '1px solid color-mix(in srgb, #22c55e 45%, var(--panel-br))',
              color: 'var(--panel-fg)',
              fontSize: 13,
              fontWeight: 600,
            }}>
              {saveMessage}
            </div>
          )}
        </div>

        <div style={{
          borderRadius: 14,
          border: '1px solid color-mix(in srgb, #60a5fa 45%, var(--panel-br))',
          background: 'linear-gradient(180deg, color-mix(in srgb, #0f172a 70%, var(--panel-bg)), color-mix(in srgb, #1d4ed8 10%, var(--panel-bg)))',
          padding: 16,
          display: 'grid',
          gap: 8,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>How your credentials are stored and used</div>
          <div style={{ color: 'var(--panel-muted)', fontSize: 14, lineHeight: 1.6 }}>
            These secrets are stored in <code>localStorage</code> in this browser, scoped to the signed-in dashboard username. They are mirrored into a same-origin cookie only so this app’s authenticated API requests can read them on the server and call GitHub, Jira, and TestRail on your behalf. The keys are NOT stored or logged anywhere in the server, and with HTTPS they are encrypted during transit as well.
          </div>
          <div style={{ color: 'var(--panel-muted)', fontSize: 14, lineHeight: 1.6 }}>
            They are not shown back in plain text in the header, and this page masks them anywhere they are echoed. If you sign in from a different browser or clear site storage, you will need to enter them again there.
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
            <Field
              label="GitHub token"
              type="password"
              value={form.githubToken}
              onChange={(value) => updateField('githubToken', value)}
              placeholder="ghp_..."
              help="Used for GitHub GraphQL and org member lookups."
            />
            <Field
              label="GitHub organization"
              value={form.githubOrg}
              onChange={(value) => updateField('githubOrg', value)}
              placeholder="aligncommerce"
            />
            <Field
              label="Jira base URL"
              value={form.jiraBaseUrl}
              onChange={(value) => updateField('jiraBaseUrl', value)}
              placeholder="https://aligncommerce.atlassian.net"
            />
            <Field
              label="Jira email"
              value={form.jiraEmail}
              onChange={(value) => updateField('jiraEmail', value)}
              placeholder="name@company.com"
            />
            <Field
              label="Jira API token"
              type="password"
              value={form.jiraToken}
              onChange={(value) => updateField('jiraToken', value)}
              placeholder="Atlassian API token"
            />
            <Field
              label="Jira story points field"
              value={form.jiraStoryPointsField}
              onChange={(value) => updateField('jiraStoryPointsField', value)}
              placeholder="customfield_11125"
            />
            <Field
              label="TestRail base URL"
              value={form.testRailBaseUrl}
              onChange={(value) => updateField('testRailBaseUrl', value)}
              placeholder="https://company.testrail.io"
              help="Optional for the main dashboard. Required for the QA page."
            />
            <Field
              label="TestRail email"
              value={form.testRailEmail}
              onChange={(value) => updateField('testRailEmail', value)}
              placeholder="qa@company.com"
              help="TestRail uses HTTP basic auth with email plus API key."
            />
            <Field
              label="TestRail API token"
              type="password"
              value={form.testRailToken}
              onChange={(value) => updateField('testRailToken', value)}
              placeholder="TestRail API key"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--panel-muted)', fontSize: 13, maxWidth: 640, lineHeight: 1.5 }}>
              {coreSettingsComplete
                ? (testRailSettingsComplete
                  ? 'Core dashboard fields and TestRail QA fields are filled. Saving will unlock the dashboard and QA page for this browser.'
                  : 'Core dashboard fields are filled. TestRail fields remain optional until you want to use the QA page.')
                : 'GitHub and Jira fields are required before the dashboard will allow navigation beyond this page.'}
            </div>
            <button
              type="submit"
              style={{
                border: '1px solid color-mix(in srgb, #3b82f6 55%, var(--panel-br))',
                background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                color: '#ffffff',
                borderRadius: 10,
                padding: '11px 16px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Save settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
