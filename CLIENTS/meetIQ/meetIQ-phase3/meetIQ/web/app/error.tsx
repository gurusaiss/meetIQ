"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="empty" style={{ marginTop: 40 }}>
      <span className="eyebrow">Something broke</span>
      <strong>That didn&apos;t work</strong>
      <div>The problem has been logged. Try again, and if it keeps happening, go back to your workspace.</div>
      <p style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button className="btn small" onClick={() => reset()}>Try again</button>
        <a className="btn small ghost" href="/">Workspace</a>
      </p>
    </div>
  );
}
