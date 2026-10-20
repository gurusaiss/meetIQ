import { redirect, forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getAccounts } from "../../lib/singletons.ts";
import { formatJoinCode } from "../../../src/auth/accounts.ts";
import { CopyCode } from "../../components/CopyCode.tsx";

export const metadata = { title: "Team · MeetIQ" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!identity.owner && !hasRole(identity, ["admin"])) forbidden();

  const accounts = getAccounts();
  const [members, code] = await Promise.all([accounts.members(identity), accounts.inviteCodeFor(identity)]);

  return (
    <>
      <span className="eyebrow">{identity.orgName}</span>
      <h1>Team &amp; invite code</h1>
      <p className="sub">Everyone who has joined this organisation. Joining never grants administrator access.</p>

      {error && <div className="notice" role="alert">{error}</div>}

      <div className="card">
        <div className="row">
          <div>
            <strong>Invite code</strong>
            <div className="kpi">
              {code
                ? "Colleagues pick their field, choose “Join”, and enter this code."
                : "Only the person who created the organisation can see its invite code."}
            </div>
          </div>
          {code && <CopyCode code={formatJoinCode(code)} />}
        </div>
      </div>

      <div className="card">
        {members.length === 0 ? (
          <p className="muted">
            Nobody has an account here yet. (The shared demo organisation uses quick demo sign-in, not accounts.)
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.email}>
                  <td>{m.name}</td>
                  <td>{m.email}</td>
                  <td>
                    {m.title} <span className="kpi">({m.role})</span>
                  </td>
                  <td>{m.since.slice(0, 10)}</td>
                  <td>
                    {(
                      <form action="/team/reset" method="post">
                        <input type="hidden" name="email" value={m.email} />
                        <button className="btn small ghost">Reset password</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
