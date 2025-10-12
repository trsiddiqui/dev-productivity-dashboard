import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dev Productivity Dashboard",
  description: "Engineering metrics dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <nav
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            background: 'white',
            position: 'sticky',
            top: 0,
            zIndex: 10
          }}
        >
          <div style={{ fontWeight: 700 }}>Dev Productivity Dashboard</div>
          <Link href="/" style={{ color: '#111' }}>Individual</Link>
          <Link href="/sprint" style={{ color: '#111' }}>Sprint</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
