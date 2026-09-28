import { redirect, notFound } from "next/navigation";
import { getIdentity } from "../../../../lib/auth.ts";
import { getRepo, getService, INSTITUTION_ID } from "../../../../lib/singletons.ts";
import { AssetPanel } from "../../../../components/AssetPanel.tsx";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const { id: lectureId } = await params;
  const lecture = await getRepo().getLecture(INSTITUTION_ID, lectureId);
  if (!lecture) notFound();

  const assets = await getService().studentAssets(INSTITUTION_ID, lectureId);
  const base = `/lectures/${encodeURIComponent(lectureId)}/export`;
  const exportHref: Record<string, string> = {
    notes: `${base}/notes.md`,
    flashcards: `${base}/flashcards.csv`,
    quiz: `${base}/quiz.md`,
  };
  const exportLabel: Record<string, string> = {
    notes: "Export .md",
    flashcards: "Export Anki .csv",
    quiz: "Export .md",
  };

  return (
    <>
      <h1>{lectureId} — study materials</h1>
      <p className="sub">Approved, verified materials from this session.</p>

      {assets.length === 0 ? (
        <div className="notice">
          No materials have been released for this session yet. They're reviewed and approved
          first.
        </div>
      ) : (
        assets.map((a) => (
          <div key={a.id}>
            <AssetPanel
              asset={a}
              mode="student"
              headerExtra={
                <a className="btn small ghost" href={exportHref[a.type]}>
                  {exportLabel[a.type]}
                </a>
              }
            />
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "20px 0" }} />
          </div>
        ))
      )}

      <p style={{ marginTop: 24 }}>
        <a href="/search">Search these sessions →</a> · <a href="/">← Dashboard</a>
      </p>
    </>
  );
}
