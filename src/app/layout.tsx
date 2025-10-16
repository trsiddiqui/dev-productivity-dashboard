import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import ThemeSelect from "./components/ThemeSelect";
import LogoutButton from "./components/LogoutButton";

import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dev Productivity Dashboard",
  description: "Engineering metrics dashboard",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(COOKIE_NAME)?.value ?? null;
  const user = await verifyToken(token);
  const authed = !!user;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try{
                  var t = localStorage.getItem('theme');
                  if(t === 'light' || t === 'dark'){
                    document.documentElement.setAttribute('data-theme', t);
                  }
                }catch(e){}
              })();`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {authed && (
          <nav className="app-nav">
            <div className="brand">Dev Productivity Dashboard</div>
            <Link href="/individual">Individual</Link>
            <Link href="/sprint">Sprint</Link>
            <div className="spacer" />
            <LogoutButton />
            <ThemeSelect />
          </nav>
        )}
        <main style={{ width: "100%" }}>{children}</main>
      </body>
    </html>
  );
}
