import { redirect } from "next/navigation";
import { forbidden } from "next/navigation";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { NewInputForm } from "../../components/NewInputForm.tsx";

const MODES = ["record", "upload", "text", "file"] as const;

export default async function NewInputPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasRole(identity, ["faculty", "ta", "admin"])) forbidden();

  const { mode } = await searchParams;
  const initialMode = (MODES as readonly string[]).includes(mode ?? "") ? (mode as (typeof MODES)[number]) : "record";
  const defaultId = `input-${Date.now().toString(36).slice(-5)}`;

  return (
    <>
      <span className="eyebrow">New input</span>
      <h1>Bring something in</h1>
      <p className="sub">
        Record, upload or paste. Then pick what to make from it: notes, flashcards, a quiz, a
        flowchart or slides.
      </p>
      <div className="card">
        <NewInputForm initialMode={initialMode} defaultId={defaultId} />
      </div>
    </>
  );
}
