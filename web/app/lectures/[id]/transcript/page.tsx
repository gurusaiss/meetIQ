import { redirect, notFound } from "next/navigation";
import { getIdentity, hasRole } from "../../../../lib/auth.ts";
import { getService } from "../../../../lib/singletons.ts";
import { isError } from "../../../../lib/http.ts";
import { config } from "../../../../../src/config.ts";
import { GroundingBadge } from "../../../../components/GroundingBadge.tsx";

export const metadata = { title: "Transcript · MeetIQ" };

function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export default async function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { id: lectureId } = await params;
  const id = encodeURIComponent(lectureId);
  const canManage = hasRole(identity, ["faculty", "ta", "admin"]);

  let transcript;
  try {
    transcript = await getService().getTranscript(identity.institutionId, lectureId, identity, "view");
  } catch (e) {
    if (isError(e, "NotFoundError")) notFound();
    if (isError(e, "AuthorizationError")) {
      return (
        <>
          <span className="eyebrow">Transcript &amp; captions</span>
          <h1>{lectureId}</h1>
          <div className="empty">
            <strong>Not released yet</strong>
            <div>
              The transcript is shown once your instructor has reviewed and released this session&apos;s
              material.
            </div>
          </div>
          <p style={{ marginTop: 24 }}>
            <a className="btn small ghost" href="/">← Dashboard</a>
          </p>
        </>
      );
    }
    throw e;
  }

  const integrity = await getService().verifyTranscriptIntegrity(identity.institutionId, lectureId, identity);
  const threshold = config.quality.confidenceFlagThreshold;
  const unclear = transcript.segments.filter((s) => s.confidence < threshold).length;

  return (
    <>
      <span className="eyebrow">Transcript &amp; captions</span>
      <h1>{lectureId}</h1>
      <p className="sub">
        The full transcript with timestamps and speakers. Download it as captions to attach to the
        recording, or as plain text.
      </p>

      <div className="card">
        <div className="row">
          <div>
            <strong>Download</strong>
            <div className="kpi">
              SRT and VTT work with video players, Canvas, Panopto and caption editors.
            </div>
          </div>
          <div className="actions">
            <a className="btn small" href={`/lectures/${id}/export/transcript.srt`}>.srt</a>
            <a className="btn small" href={`/lectures/${id}/export/transcript.vtt`}>.vtt</a>
            <a className="btn small ghost" href={`/lectures/${id}/export/transcript.txt`}>.txt</a>
          </div>
        </div>
      </div>

      <div
        className={`notice${integrity.status === "match" && integrity.auditChainOk ? " ok" : ""}`}
        role="status"
        style={integrity.status === "mismatch" ? { borderColor: "var(--danger)", color: "var(--danger)", background: "var(--danger-bg)" } : undefined}
      >
        {integrity.status === "match" && integrity.auditChainOk && (
          <>
            <strong>Unchanged since it was produced.</strong> This transcript matches the fingerprint recorded in the audit trail
            when it was processed (<code>sha256:{integrity.current.slice(0, 12)}…</code>).
          </>
        )}
        {integrity.status === "match" && !integrity.auditChainOk && (
          <>
            <strong>Matches its recorded fingerprint, but the audit trail itself failed verification.</strong> The record being
            compared against can&apos;t be fully trusted; see the audit trail.
          </>
        )}
        {integrity.status === "mismatch" && (
          <>
            <strong>This transcript has changed since it was produced.</strong> It does not match the fingerprint recorded at
            processing time (<code>sha256:{(integrity.recorded ?? "").slice(0, 12)}…</code> then,{" "}
            <code>sha256:{integrity.current.slice(0, 12)}…</code> now). Do not rely on it as a record.
          </>
        )}
        {integrity.status === "no_record" && (
          <>No fingerprint was recorded for this transcript (it was processed before integrity checking existed), so its integrity can&apos;t be shown.</>
        )}
      </div>

      {unclear > 0 && (
        <div className="notice" role="note">
          {unclear} of {transcript.segments.length} lines were hard to hear and are marked below. This is
          automatic speech recognition: check marked lines against the recording before using the
          captions as an official accommodation.
        </div>
      )}

      <div className="card">
        {transcript.segments.length === 0 ? (
          <p className="muted">This transcript is empty.</p>
        ) : (
          transcript.segments.map((s) => {
            const flagged = s.confidence < threshold;
            return (
              <div className={`tline${flagged ? " flagged" : ""}`} key={s.id} id={s.id}>
                <span className="ts">{clock(s.start)}</span>
                <div>
                  {s.speaker && <span className="who">{s.speaker}</span>}
                  <span>{s.text}</span>
                  {flagged && (
                    <div style={{ marginTop: 4 }}>
                      <GroundingBadge confidence={s.confidence} flagged />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p style={{ marginTop: 24 }}>
        {canManage && (
          <>
            <a className="btn small ghost" href={`/lectures/${id}/review`}>← Review</a>{" "}
          </>
        )}
        <a className="btn small ghost" href="/">← Dashboard</a>
      </p>
    </>
  );
}
