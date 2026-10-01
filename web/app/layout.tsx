import "./globals.css";
import type { ReactNode } from "react";
import { getIdentity } from "../lib/auth.ts";

export const metadata = {
  title: "MeetIQ — verified notes from every recording",
  description:
    "Turn any recorded meeting, lecture, or gathering into a searchable, verified knowledge base.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const identity = await getIdentity();
  return (
    <html lang="en">
      <body>
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
              {identity.role === "admin" && <a className="navlink" href="/audit">Audit</a>}
              <span className="user">
                <span className="avatar">{identity.name.slice(0, 1).toUpperCase()}</span>
                {identity.name} <span className="role-tag">{identity.role}</span>
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
