import "./globals.css";
import type { ReactNode, CSSProperties } from "react";
import { getIdentity } from "../lib/auth.ts";
import { getSector, getSectorRole } from "../../src/auth/sectors.ts";

export const metadata = {
  title: "MeetIQ — verified notes from every recording",
  description:
    "Turn any recorded meeting, lecture, or gathering into a searchable, verified knowledge base.",
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
            <span className="logo">IQ</span>
            MeetIQ
          </a>
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
                <span className="avatar">{identity.name.slice(0, 1).toUpperCase()}</span>
                {identity.name}{" "}
                <span className="role-tag">{getSectorRole(identity.sector, identity.profile)?.name ?? identity.role}</span>
              </span>
              <form action="/api/logout" method="post" style={{ display: "inline" }}>
                <button className="btn small ghost">Sign out</button>
              </form>
            </nav>
          )}
        </header>
        <main id="main" className="wrap">
          {children}
          <footer className="foot">MeetIQ · every statement cited, checked, and scored</footer>
        </main>
      </body>
    </html>
  );
}
