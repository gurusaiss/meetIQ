"use client";
import { useMemo, useState } from "react";

export interface RoleOption {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

interface Props {
  sectorId: string;
  orgLabel: string;
  orgPlaceholder: string;
  rolesCreate: RoleOption[];
  rolesJoin: RoleOption[];
  initial: { mode: "create" | "join"; name: string; email: string; org: string; role: string };
}

/** 0 (empty) .. 4, shown as a bar. Mirrors the server rule: 8+ chars with a letter and a number. */
function strength(v: string): number {
  let s = 0;
  if (v.length >= 8) s++;
  if (v.length >= 12) s++;
  if (/[A-Za-z]/.test(v) && /\d/.test(v)) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
  return s;
}
const LABELS = ["Too short", "Weak", "OK", "Good", "Strong"];

export function SignupForm({ sectorId, orgLabel, orgPlaceholder, rolesCreate, rolesJoin, initial }: Props) {
  const [mode, setMode] = useState<"create" | "join">(initial.mode);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const roles = mode === "create" ? rolesCreate : rolesJoin;
  const defaultRole = useMemo(
    () => (roles.some((r) => r.id === initial.role) ? initial.role : roles[0]?.id ?? ""),
    [roles, initial.role],
  );
  const level = password ? Math.min(4, strength(password)) : 0;
  const passwordOk = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);

  return (
    <form action="/api/signup" method="post" onSubmit={() => setBusy(true)} noValidate={false}>
      <input type="hidden" name="sector" value={sectorId} />
      <input type="hidden" name="mode" value={mode} />

      <label>What are you doing?</label>
      <div className="roles" role="radiogroup" aria-label="Create or join">
        <button type="button" className={`role pick${mode === "create" ? " on" : ""}`} onClick={() => setMode("create")} aria-pressed={mode === "create"}>
          Create an organisation
          <small>You become its administrator and get an invite code for your team.</small>
        </button>
        <button type="button" className={`role pick${mode === "join" ? " on" : ""}`} onClick={() => setMode("join")} aria-pressed={mode === "join"}>
          Join with an invite code
          <small>Your administrator gives you the code.</small>
        </button>
      </div>

      {mode === "create" ? (
        <>
          <label htmlFor="su-org">{orgLabel}</label>
          <input id="su-org" name="orgName" defaultValue={initial.org} placeholder={orgPlaceholder} required minLength={2} maxLength={80} autoComplete="organization" />
        </>
      ) : (
        <>
          <label htmlFor="su-code">Invite code</label>
          <input id="su-code" name="joinCode" placeholder="ABCD-EFGH" required maxLength={20} autoComplete="off" spellCheck={false} style={{ textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }} />
        </>
      )}

      <label>Your role</label>
      <div className="roles" role="radiogroup" aria-label="Role" key={mode}>
        {roles.map((r) => (
          <label className="role" key={r.id}>
            <input type="radio" name="roleId" value={r.id} defaultChecked={r.id === defaultRole} required />
            {r.name}
            <small>{r.desc}</small>
          </label>
        ))}
      </div>

      <div className="fields">
        <div>
          <label htmlFor="su-name">Your name</label>
          <input id="su-name" name="name" defaultValue={initial.name} required maxLength={100} autoComplete="name" />
        </div>
        <div>
          <label htmlFor="su-email">Email</label>
          <input id="su-email" name="email" type="email" defaultValue={initial.email} required maxLength={254} autoComplete="email" />
        </div>
      </div>

      <label htmlFor="su-pw">Password</label>
      <div className="pw">
        <input id="su-pw" name="password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={200} autoComplete="new-password" aria-describedby="su-pw-hint" />
        <button type="button" className="btn small ghost" onClick={() => setShow((s) => !s)} aria-pressed={show}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <div className="strength" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={level >= i ? `on l${level}` : ""} />
        ))}
      </div>
      <div className="kpi" id="su-pw-hint">
        {password ? `${LABELS[level]}. ` : ""}
        {passwordOk || !password ? "At least 8 characters, with a letter and a number." : "Add a letter and a number, 8+ characters."}
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn big" disabled={busy}>
          {busy ? (<><span className="spinner" /> Creating your account…</>) : mode === "create" ? "Create organisation →" : "Join organisation →"}
        </button>
      </div>
    </form>
  );
}
