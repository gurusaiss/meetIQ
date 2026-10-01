"use client";
import { useEffect, useRef, useState } from "react";

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

/**
 * In-browser voice recorder. The finished recording is attached to a hidden
 * file input named "media", so the normal form post uploads it exactly like a
 * chosen file would be.
 */
export function RecordPanel({ onChange }: { onChange: (hasRecording: boolean) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef<number>(0);
  const audioCtx = useRef<AudioContext | null>(null);

  function release() {
    if (timer.current) clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    void audioCtx.current?.close().catch(() => {});
    stream.current = null;
    audioCtx.current = null;
    setLevel(0);
  }
  useEffect(() => release, []);

  async function start() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording isn't supported in this browser. Use Upload recording instead.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
      chunks.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      mr.onstop = () => {
        const type = mr.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `recording.${ext}`, { type });
        const dt = new DataTransfer();
        dt.items.add(file);
        if (inputRef.current) inputRef.current.files = dt.files;
        setUrl(URL.createObjectURL(blob));
        setState("done");
        onChange(true);
      };
      recorder.current = mr;
      mr.start(1000);

      // live level meter
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();

      setSecs(0);
      timer.current = setInterval(() => setSecs((x) => x + 1), 1000);
      setState("recording");
    } catch {
      release();
      setError("Microphone access was blocked. Allow the microphone in your browser, then try again.");
    }
  }

  function stop() {
    recorder.current?.stop();
    release();
  }

  function redo() {
    if (url) URL.revokeObjectURL(url);
    setUrl("");
    if (inputRef.current) inputRef.current.value = "";
    setState("idle");
    onChange(false);
  }

  return (
    <div className="recorder">
      <input ref={inputRef} type="file" name="media" hidden />
      {state === "idle" && (
        <>
          <button type="button" className="rec-btn" onClick={start} aria-label="Start recording">
            <span className="rec-dot" />
          </button>
          <div className="rec-hint">Tap to start recording</div>
        </>
      )}
      {state === "recording" && (
        <>
          <button type="button" className="rec-btn live" onClick={stop} aria-label="Stop recording">
            <span className="rec-square" />
          </button>
          <div className="rec-time" aria-live="polite">● {fmt(secs)}</div>
          <div className="level" aria-hidden="true"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
          <div className="rec-hint">Recording… tap to stop</div>
        </>
      )}
      {state === "done" && (
        <>
          <div className="rec-time">✓ Recorded {fmt(secs)}</div>
          <audio controls src={url} style={{ width: "100%", maxWidth: 420 }} />
          <button type="button" className="btn small ghost" onClick={redo}>Record again</button>
        </>
      )}
      {error && <div className="notice" style={{ width: "100%" }}>{error}</div>}
    </div>
  );
}
