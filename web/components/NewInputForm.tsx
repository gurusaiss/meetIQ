"use client";
import { useState } from "react";
import { RecordPanel } from "./RecordPanel.tsx";

type Mode = "record" | "upload" | "text" | "file";

const MODES: { key: Mode; label: string; source: string }[] = [
  { key: "record", label: "🎙️ Record", source: "recording" },
  { key: "upload", label: "📁 Upload recording", source: "upload" },
  { key: "text", label: "✍️ Paste text", source: "text" },
  { key: "file", label: "📄 Text file", source: "text-file" },
];

export function NewInputForm({ initialMode, defaultId }: { initialMode: Mode; defaultId: string }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [hasRecording, setHasRecording] = useState(false);
  const [chars, setChars] = useState(0);
  const isAudio = mode === "record" || mode === "upload";
  const source = MODES.find((m) => m.key === mode)!.source;

  return (
    <form action="/lectures" method="post" encType="multipart/form-data">
      <div className="seg" role="tablist" aria-label="Input type">
        {MODES.map((m) => (
          <button
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            key={m.key}
            className={mode === m.key ? "on" : ""}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <input type="hidden" name="kind" value={mode === "text" || mode === "file" ? "text" : "audio"} />
      <input type="hidden" name="captureSource" value={source} />

      <label htmlFor="new-lecture-id">Name</label>
      <input
        id="new-lecture-id"
        name="lectureId"
        defaultValue={defaultId}
        required
        pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{0,62}[a-zA-Z0-9]?"
        maxLength={64}
        title="1-64 characters: letters, digits, dot, dash, underscore"
      />

      {mode === "record" && <RecordPanel onChange={setHasRecording} />}

      {mode === "upload" && (
        <>
          <label htmlFor="new-media">Recording (audio or video, max 25 MB)</label>
          <input id="new-media" type="file" name="media" accept="audio/*,video/*" required />
        </>
      )}

      {mode === "text" && (
        <>
          <label htmlFor="new-text">Your text</label>
          <textarea
            id="new-text"
            name="text"
            rows={10}
            required
            placeholder="Paste notes, an article or a transcript here…"
            onChange={(e) => setChars(e.target.value.length)}
          />
          <div className="kpi">{chars.toLocaleString()} characters</div>
        </>
      )}

      {mode === "file" && (
        <>
          <label htmlFor="new-file">Text file (.txt, .md, .srt, .vtt)</label>
          <input id="new-file" type="file" name="media" accept=".txt,.md,.markdown,.srt,.vtt,text/*" required />
        </>
      )}

      {isAudio ? (
        <label className="check" style={{ marginTop: 16 }}>
          <input type="checkbox" name="noticeShown" defaultChecked />
          <span>Recording-consent notice was shown to everyone recorded (required in all-party-consent regions)</span>
        </label>
      ) : (
        <input type="hidden" name="noticeShown" value="on" />
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" disabled={mode === "record" && !hasRecording}>
          Create input →
        </button>
        <a className="btn ghost" href="/">Cancel</a>
      </div>
      {mode === "record" && !hasRecording && (
        <div className="kpi" style={{ marginTop: 8 }}>Record something first, then create the input.</div>
      )}
    </form>
  );
}
