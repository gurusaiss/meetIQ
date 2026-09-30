import { redirect } from "next/navigation";
import { getIdentity } from "../../lib/auth.ts";
import { getService, COURSE_ID } from "../../lib/singletons.ts";

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const hits = query ? await getService().searchCourse(identity.institutionId, COURSE_ID, query, 3) : [];

  return (
    <>
      <span className="eyebrow">Search</span>
      <h1>Ask your sessions anything</h1>
      <p className="sub">
        Semantic search across every recorded session, with citations back to the exact moment.
      </p>
      <form method="get" action="/search">
        <div className="searchbar">
          <label htmlFor="search-q" className="sr-only">
            Search question
          </label>
          <input
            id="search-q"
            name="q"
            defaultValue={query}
            placeholder="e.g. How are collisions handled?"
            style={{ flex: 1 }}
          />
          <button className="btn">Search</button>
        </div>
      </form>
      <div style={{ marginTop: 16 }}>
        {!query ? (
          <div className="empty"><div className="big">💬</div>Ask a question about anything covered in your sessions.<br />Every answer links back to the exact moment it was said.</div>
        ) : hits.length === 0 ? (
          <div className="empty"><div className="big">🔎</div>No matches. Try different words.</div>
        ) : (
          hits.map((h, i) => (
            <div className="card hit" key={i}>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="ts">▶ {mmss(h.chunk.start)}</span>
                <span className="score-bar" title={`relevance ${h.score.toFixed(2)}`}>
                  <i style={{ width: `${Math.max(4, Math.min(100, Math.round(h.score * 100)))}%` }} />
                </span>
              </div>
              <div>{h.chunk.text}</div>
              <div className="cite" style={{ marginTop: 10 }}>
                cite {h.chunk.segmentIds.join(", ")} · score {h.score.toFixed(2)}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
