export const metadata = { title: "Forgot password · MeetIQ" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 440, margin: "40px auto" }}>
      <h1 style={{ fontSize: 26 }}>Reset your password</h1>
      {sent ? (
        <div className="notice ok" role="status">
          If that email has an account, a reset link is on its way. It works for 30 minutes.
        </div>
      ) : (
        <>
          <p className="sub">Enter your email and we&apos;ll send a link to reset your password.</p>
          <form action="/api/password/forgot" method="post">
            <label htmlFor="fp-email">Email</label>
            <input id="fp-email" name="email" type="email" required maxLength={254} autoComplete="email" />
            <div style={{ marginTop: 18 }}>
              <button className="btn big">Send reset link</button>
            </div>
          </form>
        </>
      )}
      <p className="kpi" style={{ marginTop: 14 }}>
        <a href="/login">← Back to sign in</a>
      </p>
    </div>
  );
}
