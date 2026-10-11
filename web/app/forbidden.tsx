export default function Forbidden() {
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <span className="eyebrow">403</span>
      <strong>That page isn&apos;t part of your role</strong>
      <div>Your account can&apos;t open this. If you think it should, ask your organisation&apos;s administrator.</div>
      <p>
        <a className="btn small" href="/">Back to your workspace</a>
      </p>
    </div>
  );
}
