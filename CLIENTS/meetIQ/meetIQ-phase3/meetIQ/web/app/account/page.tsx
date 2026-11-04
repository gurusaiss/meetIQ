import { redirect } from "next/navigation";
import { getIdentity } from "../../lib/auth.ts";
import { getSectorRole } from "../../../src/auth/sectors.ts";

export const metadata = { title: "Account · MeetIQ" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { error, ok } = await searchParams;
  const demo = identity.id.startsWith("demo-");

  return (
    <>
      <span className="eyebrow">{identity.orgName}</span>
      <h1>{identity.name}</h1>
      <p className="sub">{getSectorRole(identity.sector, identity.profile)?.name ?? identity.role}</p>

      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Change password</h2>
        {ok && <div className="notice ok" role="status">Password changed.</div>}
        {error && <div className="notice" role="alert">{error}</div>}
        {demo ? (
          <p className="kpi">Quick demo sessions have no password. Create an account to get one.</p>
        ) : (
          <form action="/api/password" method="post">
            <label htmlFor="pw-cur">Current password</label>
            <input id="pw-cur" name="current" type="password" required autoComplete="current-password" maxLength={200} />
            <label htmlFor="pw-new">New password</label>
            <input id="pw-new" name="next" type="password" required minLength={8} autoComplete="new-password" maxLength={200} />
            <label htmlFor="pw-conf">New password again</label>
            <input id="pw-conf" name="confirm" type="password" required minLength={8} autoComplete="new-password" maxLength={200} />
            <div style={{ marginTop: 18 }}>
              <button className="btn">Save new password</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
