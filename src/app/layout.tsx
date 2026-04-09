import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "react-day-picker/style.css";
import "./globals.css";
import ThemeSelect from "./components/ThemeSelect";
import LogoutButton from "./components/LogoutButton";
import RuntimeSettingsStatus from "./components/RuntimeSettingsStatus";
import SettingsAccessGate from "./components/SettingsAccessGate";

import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import {
  DEFAULT_JIRA_BASE_URL,
  DEFAULT_JIRA_STORY_POINTS_FIELD,
  RUNTIME_QA_SETTINGS_COOKIE_NAME,
  RUNTIME_SETTINGS_COOKIE_NAME,
  RUNTIME_SETTINGS_STORAGE_PREFIX,
} from "@/lib/runtime-settings";

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
  const runtimeSettingsBootstrapScript = authed ? `
    (function(){
      try{
        var username = ${JSON.stringify(user)};
        if(!username) return;
        var raw = localStorage.getItem(${JSON.stringify(`${RUNTIME_SETTINGS_STORAGE_PREFIX}:`)} + username);
        if(!raw){
          document.cookie = ${JSON.stringify(RUNTIME_SETTINGS_COOKIE_NAME)} + '=; Path=/; Max-Age=0; SameSite=Lax';
          document.cookie = ${JSON.stringify(RUNTIME_QA_SETTINGS_COOKIE_NAME)} + '=; Path=/; Max-Age=0; SameSite=Lax';
          return;
        }
        var parsed = JSON.parse(raw) || {};
        var normalized = {
          username: username,
          githubToken: typeof parsed.githubToken === 'string' ? parsed.githubToken.trim() : '',
          githubOrg: typeof parsed.githubOrg === 'string' ? parsed.githubOrg.trim() : '',
          jiraBaseUrl: typeof parsed.jiraBaseUrl === 'string' && parsed.jiraBaseUrl.trim() ? parsed.jiraBaseUrl.trim() : ${JSON.stringify(DEFAULT_JIRA_BASE_URL)},
          jiraEmail: typeof parsed.jiraEmail === 'string' ? parsed.jiraEmail.trim() : '',
          jiraToken: typeof parsed.jiraToken === 'string' ? parsed.jiraToken.trim() : '',
          jiraStoryPointsField: typeof parsed.jiraStoryPointsField === 'string' && parsed.jiraStoryPointsField.trim() ? parsed.jiraStoryPointsField.trim() : ${JSON.stringify(DEFAULT_JIRA_STORY_POINTS_FIELD)},
          testRailBaseUrl: typeof parsed.testRailBaseUrl === 'string' ? parsed.testRailBaseUrl.trim() : '',
          testRailEmail: typeof parsed.testRailEmail === 'string' ? parsed.testRailEmail.trim() : '',
          testRailToken: typeof parsed.testRailToken === 'string' ? parsed.testRailToken.trim() : ''
        };
        var complete = !!(normalized.githubToken && normalized.githubOrg && normalized.jiraBaseUrl && normalized.jiraEmail && normalized.jiraToken && normalized.jiraStoryPointsField);
        if(!complete){
          document.cookie = ${JSON.stringify(RUNTIME_SETTINGS_COOKIE_NAME)} + '=; Path=/; Max-Age=0; SameSite=Lax';
          document.cookie = ${JSON.stringify(RUNTIME_QA_SETTINGS_COOKIE_NAME)} + '=; Path=/; Max-Age=0; SameSite=Lax';
          return;
        }
        var coreCookiePayload = {
          username: normalized.username,
          githubToken: normalized.githubToken,
          githubOrg: normalized.githubOrg,
          jiraBaseUrl: normalized.jiraBaseUrl,
          jiraEmail: normalized.jiraEmail,
          jiraToken: normalized.jiraToken,
          jiraStoryPointsField: normalized.jiraStoryPointsField
        };
        document.cookie = ${JSON.stringify(RUNTIME_SETTINGS_COOKIE_NAME)} + '=' + encodeURIComponent(JSON.stringify(coreCookiePayload)) + '; Path=/; Max-Age=31536000; SameSite=Lax';
        var qaComplete = !!(normalized.testRailBaseUrl && normalized.testRailEmail && normalized.testRailToken);
        if(qaComplete){
          var qaCookiePayload = {
            username: normalized.username,
            testRailBaseUrl: normalized.testRailBaseUrl,
            testRailEmail: normalized.testRailEmail,
            testRailToken: normalized.testRailToken
          };
          document.cookie = ${JSON.stringify(RUNTIME_QA_SETTINGS_COOKIE_NAME)} + '=' + encodeURIComponent(JSON.stringify(qaCookiePayload)) + '; Path=/; Max-Age=31536000; SameSite=Lax';
        }else{
          document.cookie = ${JSON.stringify(RUNTIME_QA_SETTINGS_COOKIE_NAME)} + '=; Path=/; Max-Age=0; SameSite=Lax';
        }
      }catch(e){}
    })();`
    : '';

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
        {authed && (
          <script
            dangerouslySetInnerHTML={{
              __html: runtimeSettingsBootstrapScript,
            }}
          />
        )}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SettingsAccessGate username={user ?? ''}>
          {authed && (
            <nav className="app-nav">
              <div className="brand">Dev Productivity Dashboard</div>
              <Link href="/individual">Individual</Link>
              <Link href="/contributions">Contributions</Link>
              <Link href="/sprint">Sprint</Link>
              <Link href="/qa">QA</Link>
              <Link href="/settings">Settings</Link>
              <div className="spacer" />
              <RuntimeSettingsStatus username={user ?? ''} />
              <LogoutButton />
              <ThemeSelect />
            </nav>
          )}
          <main style={{ width: "100%" }}>{children}</main>
        </SettingsAccessGate>
      </body>
    </html>
  );
}
