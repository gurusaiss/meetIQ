import { redirect } from "next/navigation";
import { getIdentity } from "../../lib/auth.ts";
import { config } from "../../../src/config.ts";
import { SECTORS } from "../../../src/auth/sectors.ts";

const DEMO_ROLES = [
  { value: "faculty", icon: "🎓", title: "Faculty", desc: "Record, review, approve" },
  { value: "ta", icon: "🧑‍🏫", title: "TA", desc: "Review & approve" },
  { value: "student", icon: "📖", title: "Student", desc: "Study approved material" },
  { value: "admin", icon: "🛡️", title: "Admin", desc: "Audit & retention" },
  { value: "auditor", icon: "🔍", title: "Auditor", desc: "Read-only audit trail" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const identity = await getIdentity();
  if (identity) redirect("/");
  const { error, email } = await searchParams;

  return (
    <>
      <div className="login">
        <section className="hero">
          <span className="eyebrow">Verified meeting intelligence</span>
          <h1>
            Notes you can <span className="grad">actually trust.</span>
          </h1>
          <p className="sub">
            Record or paste anything. MeetIQ writes notes, flashcards, a quiz, a flowchart and slides,
            and every line is checked against the real transcript before you ever see it.
          </p>
          <div className="feature">
            <i>🔗</i>
            <div>
              <b>Every statement is cited</b>
              <span className="muted">Linked to the exact moment it was said.</span>
            </div>
          </div>
          <div className="feature">
            <i>🛡️</i>
            <div>
              <b>Unverifiable content is deleted</b>
              <span className="muted">Not shown with a disclaimer. Gone.</span>
            </div>
          </div>
          <div className="feature">
            <i>📊</i>
            <div>
              <b>Confidence on every item</b>
              <span className="muted">Mumbled audio is flagged, not hidden.</span>
            </div>
          </div>
        </section>

        <div className="card" style={{ padding: 26 }}>
          <h2 style={{ fontSize: 22 }}>Sign in</h2>
          {error && <div className="notice" role="alert">{error}</div>}
          <form action="/api/signin" method="post">
            <label htmlFor="in-email">Email</label>
            <input id="in-email" name="email" type="email" defaultValue={email ?? ""} required maxLength={254} autoComplete="email" />
            <label htmlFor="in-pw">Password</label>
            <input id="in-pw" name="password" type="password" required maxLength={200} autoComplete="current-password" />
            <div style={{ marginTop: 20 }}>
              <button className="btn big">Sign in →</button>
            </div>
          </form>
          <p className="kpi" style={{ marginTop: 14 }}>
            New here? <a href="/signup">Create an account</a>: choose your field, then create or join an organisation.
          </p>
        </div>
      </div>

      <div className="section-title">Pick your field</div>
      <div className="sectors">
        {SECTORS.map((s) => (
          <a className="sector" href={`/signup/${s.id}`} key={s.id} style={{ ["--accent" as string]: s.accent }}>
            <span className="sector-icon">{s.icon}</span>
            <b>{s.name}</b>
            <span className="kpi">{s.tag}</span>
          </a>
        ))}
      </div>

      {config.security.demoLogin && (
        <div className="card" style={{ marginTop: 28 }}>
          <h3 style={{ margin: 0 }}>Just looking around?</h3>
          <p className="kpi" style={{ margin: "4px 0 0" }}>
            Quick demo: no password, into a shared sample university. Don&apos;t put real data here.
          </p>
          <form action="/api/login" method="post">
            <label htmlFor="login-name">Your name</label>
            <input id="login-name" name="name" defaultValue="Anika Rao" required maxLength={100} />
            <label>Continue as</label>
            <div className="roles roles3" role="radiogroup">
              {DEMO_ROLES.map((r) => (
                <label className="role" key={r.value}>
                  <input type="radio" name="role" value={r.value} defaultChecked={r.value === "faculty"} />
                  {r.icon} {r.title}
                  <small>{r.desc}</small>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 18 }}>
              <button className="btn ghost">Enter the demo →</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
