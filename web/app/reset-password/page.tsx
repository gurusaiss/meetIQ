export const metadata = { title: "Reset password · MeetIQ" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) {
    return (
      <div className="card" style={{ maxWidth: 440, margin: "40px auto" }}>
        <h1 style={{ fontSize: 26 }}>Reset password</h1>
        <div className="notice" role="alert">This link is missing its token. Request a new one.</div>
        <p className="kpi" style={{ marginTop: 14 }}><a href="/forgot-password">Request a reset link →</a></p>
      </div>
    );
  }
  return (
    <div className="card" style={{ maxWidth: 440, margin: "40px auto" }}>
      <h1 style={{ fontSize: 26 }}>Choose a new password</h1>
      {error && <div className="notice" role="alert">{error}</div>}
      <form action="/api/password/reset" method="post">
        <input type="hidden" name="token" value={token} />
        <label htmlFor="rp-next">New password</label>
        <input id="rp-next" name="next" type="password" required minLength={8} autoComplete="new-password" maxLength={200} />
        <label htmlFor="rp-confirm">New password again</label>
        <input id="rp-confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" maxLength={200} />
        <div style={{ marginTop: 18 }}>
          <button className="btn big">Set new password</button>
        </div>
      </form>
    </div>
  );
}
