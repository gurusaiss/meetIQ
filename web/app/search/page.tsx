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
      <h1>Chat with the course</h1>
      <p className="sub">
        Semantic search across every lecture, with citations back to the exact moment.
      </p>
      <form method="get" action="/search">
        <div className="row">
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
          <p className="muted">Ask a question about anything covered in the course.</p>
        ) : hits.length === 0 ? (
          <p className="muted">No matches.</p>
        ) : (
          hits.map((h, i) => (
            <div className="card" key={i}>
              <div>{h.chunk.text}</div>
              <div className="cite" style={{ marginTop: 8 }}>
                cite {h.chunk.segmentIds.join(", ")} · @{mmss(h.chunk.start)} · score{" "}
                {h.score.toFixed(2)}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
