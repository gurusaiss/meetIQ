import { redirect } from "next/navigation";
import { getIdentity } from "../../lib/auth.ts";

const ROLES = [
  { value: "faculty", icon: "🎓", title: "Faculty", desc: "Record, review, approve" },
  { value: "ta", icon: "🧑‍🏫", title: "TA", desc: "Review & approve" },
  { value: "student", icon: "📖", title: "Student", desc: "Study approved material" },
  { value: "admin", icon: "🛡️", title: "Admin", desc: "Audit & retention" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const identity = await getIdentity();
  if (identity) redirect("/");
  const { error } = await searchParams;

  return (
    <div className="login">
      <section className="hero">
        <span className="eyebrow">Verified meeting intelligence</span>
        <h1>
          Notes you can <span className="grad">actually trust.</span>
        </h1>
        <p className="sub">
          Upload a recording. MeetIQ writes notes, flashcards and a quiz, and every line is checked
          against the real transcript before you ever see it.
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
        <p className="kpi" style={{ margin: "4px 0 0" }}>
          Demo mode: in production this is your institution&apos;s SSO.
        </p>
        {error && <div className="notice">{error}</div>}
        <form action="/api/login" method="post">
          <label htmlFor="login-name">Your name</label>
          <input id="login-name" name="name" defaultValue="Anika Rao" required />
          <label>Continue as</label>
          <div className="roles" role="radiogroup">
            {ROLES.map((r) => (
              <label className="role" key={r.value}>
                <input type="radio" name="role" value={r.value} defaultChecked={r.value === "faculty"} />
                {r.icon} {r.title}
                <small>{r.desc}</small>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 20 }}>
            <button className="btn big">Sign in →</button>
          </div>
        </form>
      </div>
    </div>
  );
}
