'use client';

import { JSX } from 'react';

export interface ContributionSignalDatum {
  metric: string;
  section: string;
  primary: number;
  secondary: number;
  format: 'count' | 'percent' | 'hours' | 'days' | 'loc';
  lowerIsBetter?: boolean;
}

interface Props {
  title: string;
  subtitle?: string;
  primaryLabel: string;
  secondaryLabel: string;
  items: ContributionSignalDatum[];
}

function formatSignalValue(value: number, format: ContributionSignalDatum['format']): string {
  if (format === 'percent') return `${value.toLocaleString()}%`;
  if (format === 'hours') return `${value.toLocaleString()}h`;
  if (format === 'days') return `${value.toLocaleString()}d`;
  if (format === 'loc') return `${value.toLocaleString()} LOC`;
  return value.toLocaleString();
}

function compareTone(item: ContributionSignalDatum): {
  accent: string;
  text: string;
} {
  if (item.primary === item.secondary) {
    return { accent: '#94a3b8', text: 'Even' };
  }

  const primaryWins = item.lowerIsBetter
    ? item.primary < item.secondary
    : item.primary > item.secondary;

  return primaryWins
    ? { accent: '#60a5fa', text: 'Primary ahead' }
    : { accent: '#f59e0b', text: 'Comparison ahead' };
}

export function ContributionSignalsChart({
  title,
  subtitle,
  primaryLabel,
  secondaryLabel,
  items,
}: Props): JSX.Element {
  const sections = Array.from(new Set(items.map((item) => item.section)));

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h3 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h3>
          {subtitle ? (
            <p style={{ marginTop: 6, fontSize: 13, color: 'var(--panel-muted)', maxWidth: 860 }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220, padding: '12px 14px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(96,165,250,0.16), rgba(37,99,235,0.12))', border: '1px solid rgba(96,165,250,0.26)' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#bfdbfe', fontWeight: 700 }}>Primary</div>
            <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{primaryLabel}</div>
          </div>
          <div style={{ minWidth: 220, padding: '12px 14px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(245,158,11,0.16), rgba(249,115,22,0.10))', border: '1px solid rgba(245,158,11,0.26)' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fde68a', fontWeight: 700 }}>Comparison</div>
            <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{secondaryLabel}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 18 }}>
        {sections.map((section) => {
          const rows = items.filter((item) => item.section === section);
          return (
            <section key={section}>
              <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>
                {section}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {rows.map((item) => {
                  const max = Math.max(item.primary, item.secondary, 1);
                  const tone = compareTone(item);
                  const spread = Math.abs(item.primary - item.secondary);

                  return (
                    <div
                      key={item.metric}
                      style={{
                        background: 'linear-gradient(180deg, color-mix(in srgb, var(--card-bg) 86%, transparent), color-mix(in srgb, var(--panel-bg) 94%, transparent))',
                        border: '1px solid var(--panel-br)',
                        borderRadius: 14,
                        padding: 14,
                        display: 'grid',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700 }}>{item.metric}</div>
                        </div>
                        <div style={{ padding: '4px 8px', borderRadius: 999, background: `${tone.accent}1c`, color: tone.accent, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {tone.text}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.18)' }}>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#bfdbfe', fontWeight: 700 }}>Primary</div>
                          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: '#dbeafe' }}>
                            {formatSignalValue(item.primary, item.format)}
                          </div>
                        </div>
                        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.18)' }}>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fde68a', fontWeight: 700 }}>Comparison</div>
                          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: '#ffedd5' }}>
                            {formatSignalValue(item.secondary, item.format)}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gap: 8 }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5, fontSize: 12, color: 'var(--panel-muted)' }}>
                            <span>Primary</span>
                            <span>{formatSignalValue(item.primary, item.format)}</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.12)', overflow: 'hidden' }}>
                            <div style={{ width: `${(item.primary / max) * 100}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #60a5fa, #2563eb)' }} />
                          </div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5, fontSize: 12, color: 'var(--panel-muted)' }}>
                            <span>Comparison</span>
                            <span>{formatSignalValue(item.secondary, item.format)}</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.12)', overflow: 'hidden' }}>
                            <div style={{ width: `${(item.secondary / max) * 100}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #f59e0b, #f97316)' }} />
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12 }}>
                        <span style={{ color: 'var(--panel-muted)' }}>Spread</span>
                        <span style={{ fontWeight: 700 }}>{formatSignalValue(spread, item.format)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
