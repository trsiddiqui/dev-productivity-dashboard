'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const sp = useSearchParams();
  const next = sp.get('next') || '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error || 'Login failed');
      }
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'grid',
      placeItems: 'center',
      background: 'radial-gradient(1000px 600px at 10% 10%, #1f2937 0%, rgba(0,0,0,0) 70%), linear-gradient(180deg, #0a0a0a 0%, #000 100%)'
    }}>
      <div style={{
        width: 360,
        background: 'var(--surface)',
        color: 'var(--foreground)',
        border: '1px solid var(--surface-border)',
        borderRadius: 16,
        padding: 24,
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Dev Productivity Dashboard</div>
          <div style={{ fontSize: 13, color: 'var(--faint-text)' }}>Sign in to continue</div>
        </div>

        {error && (
          <div style={{ background: '#ffe4e6', color: '#7f1d1d', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--faint-text)' }}>Username</span>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--surface-border)', background: 'var(--background)', color: 'var(--foreground)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--faint-text)' }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--surface-border)', background: 'var(--background)', color: 'var(--foreground)' }}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            style={{ marginTop: 6, padding: '10px 12px', borderRadius: 10, border: 0, background: '#111', color: '#fff', fontWeight: 700, opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
