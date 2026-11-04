import { redirect } from "next/navigation";
import { getIdentity } from "../../../../lib/auth.ts";
import { takeFlash } from "../../../../lib/flash.ts";
import { CopyCode } from "../../../../components/CopyCode.tsx";

export const metadata = { title: "Temporary password · MeetIQ" };

export default async function ResetResult({ params }: { params: Promise<{ token: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { token } = await params;
  const r = takeFlash<{ name: string; email: string; temporary: string }>(token, identity.id);
  if (!r) redirect("/team");

  return (
    <>
      <span className="eyebrow">Password reset</span>
      <h1>Temporary password for {r.name}</h1>
      <p className="sub">
        Give this to {r.email} yourself. It is shown once and can&apos;t be looked up again. They should
        change it under Account after signing in.
      </p>
      <div className="card">
        <CopyCode code={r.temporary} />
      </div>
      <p><a className="btn small ghost" href="/team">Back to team</a></p>
    </>
  );
}
