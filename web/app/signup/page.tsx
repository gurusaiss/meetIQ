import { redirect } from "next/navigation";
import { getIdentity } from "../../lib/auth.ts";
import { SECTORS } from "../../../src/auth/sectors.ts";

export const metadata = { title: "Create your account · MeetIQ" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getIdentity()) redirect("/");
  const { error } = await searchParams;

  return (
    <>
      <span className="eyebrow">Step 1 of 2</span>
      <h1>What field are you in?</h1>
      <p className="sub">
        This sets the roles, wording and tools you&apos;ll see. You can create an organisation or
        join one your administrator already made.
      </p>
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="sectors">
        {SECTORS.map((s) => (
          <a className="sector" href={`/signup/${s.id}`} key={s.id} style={{ ["--accent" as string]: s.accent }}>
            <span className="sector-icon">{s.icon}</span>
            <b>{s.name}</b>
            <span className="kpi">{s.tag}</span>
            <span className="kpi">{s.roles.map((r) => r.name).join(" · ")}</span>
          </a>
        ))}
      </div>
      <p className="kpi" style={{ marginTop: 20 }}>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </>
  );
}
