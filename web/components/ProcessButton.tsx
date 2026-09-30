"use client";
import { useState } from "react";

/** Process runs the whole pipeline inside one request; show progress and block double-submits. */
export function ProcessForm({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      action={`/lectures/${encodeURIComponent(id)}/process`}
      method="post"
      style={{ display: "inline" }}
      onSubmit={(e) => {
        if (busy) e.preventDefault();
        else setBusy(true);
      }}
    >
      <button className="btn small" aria-disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" /> Transcribing &amp; verifying… this can take a minute
          </>
        ) : (
          "▶ Process"
        )}
      </button>
    </form>
  );
}
