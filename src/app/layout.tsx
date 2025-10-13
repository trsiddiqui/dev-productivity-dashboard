import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import ThemeSelect from "./components/ThemeSelect";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dev Productivity Dashboard",
  description: "Engineering metrics dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
        <head>
    <script
      dangerouslySetInnerHTML={{
        __html: `
zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz
          (function() {
            function setTheme(newTheme) {             document.documentElement.setAttribute('data-theme', newTheme);
            }               
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <nav className="app-nav">
          <div className="brand">Dev Productivity Dashboard</div>
          <Link href="/">Individual</Link>
          <Link href="/sprint">Sprint</Link>
          <div className="spacer" />
          <ThemeSelect />
        </nav>
        <main style={{ width: "100%" }}>{children}</main>
      </body>
    </html>
  );
}
