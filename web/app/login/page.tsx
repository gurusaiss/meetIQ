import { redirect } from "next/navigation";
import { getIdentity } from "../../lib/auth.ts";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const identity = await getIdentity();
  if (identity) redirect("/");
  const { error } = await searchParams;

  return (
    <>
      <h1>Sign in</h1>
      <p className="sub">
        In production this is your organization&apos;s SSO (SAML / LMS LTI). For this demo, choose
        an identity.
      </p>
      {error && <div className="notice">{error}</div>}
      <div className="card">
        <form action="/api/login" method="post">
          <label htmlFor="login-name">Name</label>
          <input id="login-name" name="name" defaultValue="Anika Rao" required />
          <label htmlFor="login-role">Role</label>
          <select id="login-role" name="role" defaultValue="faculty">
            <option value="faculty">faculty — record, review, approve, delete</option>
            <option value="ta">ta — review &amp; approve</option>
            <option value="student">student — study approved materials</option>
            <option value="admin">admin — audit &amp; retention</option>
          </select>
          <div style={{ marginTop: 14 }}>
            <button className="btn">Sign in</button>
          </div>
        </form>
      </div>
    </>
  );
}
