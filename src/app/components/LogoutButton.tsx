'use client';

export default function LogoutButton() {
  async function handle() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }
  return (
    <button
      onClick={handle}
      className="app-header-icon-button"
    >
      Logout
    </button>
  );
}
