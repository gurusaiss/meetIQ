import "./globals.css";
import type { ReactNode, CSSProperties } from "react";
import { PwaSetup } from "../components/PwaSetup.tsx";
import { getIdentity } from "../lib/auth.ts";
import { getSector, getSectorRole } from "../../src/auth/sectors.ts";

export const metadata = {
  title: "MeetIQ — verified notes from every recording",
  description:
    "Turn any recorded meeting, lecture, or gathering into a searchable, verified knowledge base.",
  applicationName: "MeetIQ",
  appleWebApp: { capable: true, title: "MeetIQ", statusBarStyle: "default" as const },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2ede3" },
    { media: "(prefers-color-scheme: dark)", color: "#15130e" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const identity = await getIdentity();
  const accent = getSector(identity?.sector)?.accent;
  return (
    <html lang="en">
      <body style={accent ? ({ ["--sector" as string]: accent } as CSSProperties) : undefined}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="top">
          <a className="brand" href="/">
            <svg className="logo" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m7.5 12.5 3 3 6-7" /></svg>
            <span>Meet<b>IQ</b></span>
          </a>
          <PwaSetup />
          {identity && (
            <nav>
              <a className="navlink" href="/">Workspace</a>
              <a className="navlink" href="/search">Search</a>
              {(identity.role === "faculty" || identity.role === "ta" || identity.role === "admin") && (
                <a className="navlink" href="/approvals">Approvals</a>
              )}
              {(identity.role === "admin" || identity.role === "auditor") && (
                <a className="navlink" href="/audit">Audit</a>
              )}
              <span className="user" title={identity.orgName}>
                <span className="avatar" aria-hidden="true">{identity.name.slice(0, 1).toUpperCase()}</span>
                {identity.name}{" "}
                <span className="role-tag">{getSectorRole(identity.sector, identity.profile)?.name ?? identity.role}</span>
              </span>
              <a className="navlink" href="/account">Account</a>
              <form action="/api/logout" method="post" style={{ display: "inline" }}>
                <button className="btn small ghost">Sign out</button>
              </form>
            </nav>
          )}
        </header>
        <main id="main" className="wrap">
          {children}
          <footer className="foot">MeetIQ · every line traced to the transcript</footer>
        </main>
      </body>
    </html>
  );
}
