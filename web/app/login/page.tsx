import { redirect } from "next/navigation";
import { getIdentity } from "../../lib/auth.ts";
import { config } from "../../../src/config.ts";
import { SECTORS } from "../../../src/auth/sectors.ts";

const DEMO_ROLES = [
  { value: "faculty", title: "Faculty", desc: "Record, review, approve" },
  { value: "ta", title: "TA", desc: "Review & approve" },
  { value: "student", title: "Student", desc: "Study approved material" },
  { value: "admin", title: "Admin", desc: "Audit & retention" },
  { value: "auditor", title: "Auditor", desc: "Read-only audit trail" },
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
          <span className="eyebrow">Recordings in, checked notes out</span>
          <h1>
            Every line traced back to <em>what was actually said.</em>
          </h1>
          <p className="sub">
            Record a meeting or paste some text. MeetIQ drafts notes, flashcards, a quiz, a flowchart and
            slides, then throws away anything it can&apos;t find in the transcript.
          </p>
          <ol className="proof">
            <li>
              <b>Cited</b>
              <span>Each statement links to the moment in the recording it came from.</span>
            </li>
            <li>
              <b>Deleted, not disclaimed</b>
              <span>If a claim can&apos;t be matched to the transcript, it never reaches you.</span>
            </li>
            <li>
              <b>Scored</b>
              <span>Muffled audio is flagged with a confidence figure rather than hidden.</span>
            </li>
          </ol>
        </section>

        <div className="card" style={{ padding: 26 }}>
          <h2>Sign in</h2>
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
            New here? <a href="/signup">Create an account</a>. You choose your field, then start an organisation or join one.
          </p>
        </div>
      </div>

      <div className="section-title">Or start with your field</div>
      <div className="sectors">
        {SECTORS.map((s, i) => (
          <a className="sector" href={`/signup/${s.id}`} key={s.id} style={{ ["--accent" as string]: s.accent }}>
            <span className="sector-no">{String(i + 1).padStart(2, "0")}</span>
            <b>{s.name}</b>
            <span className="kpi">{s.tag}</span>
          </a>
        ))}
      </div>

      {config.security.demoLogin && (
        <div className="card" style={{ marginTop: 28 }}>
          <h3 className="h3">Just looking around?</h3>
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
                  {r.title}
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
