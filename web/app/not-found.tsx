export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <span className="eyebrow">404</span>
      <strong>We couldn&apos;t find that</strong>
      <div>It may have been deleted, or it belongs to a different organisation.</div>
      <p>
        <a className="btn small" href="/">Back to your workspace</a>
      </p>
    </div>
  );
}
