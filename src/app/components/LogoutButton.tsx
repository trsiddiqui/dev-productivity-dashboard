'use client';

export default function LogoutButton() {
  async function handle() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }
  return (
    <button
      onClick={handle}
      style={{ border: '1px solid var(--surface-border)', background: 'transparent', color: 'var(--surface-link)', borderRadius: 8, padding: '6px 10px' }}
    >
      Logout
    </button>
  );
}