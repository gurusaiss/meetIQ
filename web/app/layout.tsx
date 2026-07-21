import "./globals.css";
import type { ReactNode } from "react";
import { getIdentity } from "../lib/auth.ts";

export const metadata = {
  title: "Lecture Intelligence",
  description: "Turn in-person lecture recordings into study-ready, searchable knowledge.",
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
          <div className="brand">📚 Lecture Intelligence</div>
          {identity && (
            <nav>
              <a href="/">Dashboard</a>
              <a href="/search">Search</a>
              {identity.role === "admin" && <a href="/audit">Audit</a>}
              <span className="chip" style={{ marginLeft: 16 }}>
                {identity.name} · {identity.role}
              </span>
              <form action="/api/logout" method="post" style={{ display: "inline", marginLeft: 8 }}>
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
