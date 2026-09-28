import "./globals.css";
import type { ReactNode } from "react";
import { getIdentity } from "../lib/auth.ts";

export const metadata = {
  title: "MeetIQ",
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
          <div className="brand">📚 MeetIQ</div>
          {identity && (
            <nav>
              <a href="/">Dashboard</a>
              <a href="/search">Search</a>
              {identity.role === "admin" && <a href="/audit">Audit</a>}
              <span className="chip">
                {identity.name} · {identity.role}
              </span>
              <form action="/api/logout" method="post" style={{ display: "inline" }}>
                <button className="btn small ghost">Sign out</button>
              </form>
            </nav>
          )}
        </header>
        <main id="main" className="wrap">
          {children}
        </main>
      </body>
    </html>
  );
}
