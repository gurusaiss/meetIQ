import { redirect } from "next/navigation";
import { getIdentity } from "../../../lib/auth.ts";
import { getSector, selectableRoles } from "../../../../src/auth/sectors.ts";
import { SignupForm } from "../../../components/SignupForm.tsx";

type Q = { error?: string; mode?: string; name?: string; email?: string; org?: string; role?: string };

export default async function SignupSectorPage({
  params,
  searchParams,
}: {
  params: Promise<{ sector: string }>;
  searchParams: Promise<Q>;
}) {
  if (await getIdentity()) redirect("/");
  const { sector: sectorId } = await params;
  const sector = getSector(sectorId);
  if (!sector) redirect("/signup");
  const q = await searchParams;

  const pick = (r: { id: string; name: string; icon: string; desc: string }) => ({
    id: r.id, name: r.name, icon: r.icon, desc: r.desc,
  });

  return (
    <div style={{ ["--accent" as string]: sector.accent }}>
      <span className="eyebrow">Step 2 of 2 · {sector.name}</span>
      <h1>
        Create your account
      </h1>
      <p className="sub">{sector.blurb}</p>
      <div className="card" style={{ padding: 26 }}>
        {q.error && <div className="notice" role="alert">{q.error}</div>}
        <SignupForm
          sectorId={sector.id}
          orgLabel={sector.orgLabel}
          orgPlaceholder={sector.orgPlaceholder}
          rolesCreate={selectableRoles(sector, "create").map(pick)}
          rolesJoin={selectableRoles(sector, "join").map(pick)}
          initial={{
            mode: q.mode === "join" ? "join" : "create",
            name: q.name ?? "",
            email: q.email ?? "",
            org: q.org ?? "",
            role: q.role ?? "",
          }}
        />
      </div>
      <p className="kpi" style={{ marginTop: 16 }}>
        <a href="/signup">← Different field</a> · Already have an account? <a href="/login">Sign in</a>
      </p>
    </div>
  );
}
