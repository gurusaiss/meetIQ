/**
 * Sector catalogue: the fields a person picks before signing up, the roles
 * each field has, and how every role maps onto the permission model.
 *
 * Permissions never come from the sector title. Each role carries a `base`
 * (`student | faculty | ta | admin | auditor`), and every route/service check
 * uses that. The title (Dean, Partner, Trainee, ...) is display only. So a new
 * sector or role can't accidentally grant more than its `base` allows.
 */
import type { Role } from "./session.ts";

export type RoleKind = "admin" | "review" | "maker" | "receiver";

export interface SectorRole {
  id: string;
  name: string;
  icon: string;
  kind: RoleKind;
  /** The permission role this title maps to. */
  base: Role;
  desc: string;
}

/** Tile keys whose title/description a sector may reword. */
export type WordKey =
  | "record" | "upload" | "text" | "file"
  | "notes" | "flashcards" | "quiz" | "flowchart" | "slides" | "search";

export interface Sector {
  id: string;
  name: string;
  icon: string;
  /** Accent colour for this sector's pages. */
  accent: string;
  tag: string;
  orgLabel: string;
  orgPlaceholder: string;
  /** What one recording is called here ("class", "meeting", "hearing"...). */
  noun: { one: string; many: string };
  blurb: string;
  points: string[];
  roles: SectorRole[];
  words: Partial<Record<WordKey, [string, string]>>;
}

const R = (
  id: string, name: string, icon: string, kind: RoleKind, base: Role, desc: string,
): SectorRole => ({ id, name, icon, kind, base, desc });

export const SECTORS: Sector[] = [
  {
    id: "uni", name: "University & College", icon: "🎓", accent: "#4f46e5",
    tag: "Classes, labs and exams",
    orgLabel: "University or college name", orgPlaceholder: "State University",
    noun: { one: "class", many: "classes" },
    blurb: "Record a class, get verified notes, flashcards and a quiz, and release them to students after approval.",
    points: ["Faculty record and approve before students see anything", "Students study only approved material", "Consent and audit trail built in"],
    roles: [
      R("admin", "Admin", "🛡️", "admin", "admin", "Audit trail, retention and your team"),
      R("dean", "Dean", "🏛️", "review", "admin", "Approve content, audit and retention"),
      R("faculty", "Faculty", "🎓", "maker", "faculty", "Record, review, approve and export"),
      R("student", "Student", "📖", "receiver", "student", "Study approved material and search"),
    ],
    words: {
      record: ["Record class", "Record a lecture from your microphone and get verified notes."],
      upload: ["Upload lecture", "Add a lecture recording you already have."],
      notes: ["Class notes", "Cited, confidence-scored notes for each class."],
      slides: ["Class slides", "Download a PowerPoint deck of the verified notes."],
      search: ["Ask your classes", "Search every class, with the exact moment cited."],
    },
  },
  {
    id: "org", name: "Organization", icon: "🏢", accent: "#0369a1",
    tag: "Meetings, teams and training",
    orgLabel: "Company name", orgPlaceholder: "Acme Corp",
    noun: { one: "meeting", many: "meetings" },
    blurb: "Minutes and decisions your team can trust, every line cited to what was actually said.",
    points: ["Managers record meetings and approve the minutes", "Employees see only approved minutes", "Every action is logged"],
    roles: [
      R("admin", "Admin", "🛡️", "admin", "admin", "Audit trail, retention and your team"),
      R("hr", "HR", "👥", "review", "ta", "Review and approve content"),
      R("manager", "Manager", "💼", "maker", "faculty", "Record meetings, approve minutes"),
      R("employee", "Employee", "🙋", "receiver", "student", "Read approved minutes and search"),
    ],
    words: {
      record: ["Record meeting", "Capture a meeting and get verified minutes."],
      upload: ["Upload meeting", "Add a meeting or call recording."],
      notes: ["Meeting minutes", "Cited minutes with decisions, by topic."],
      slides: ["Meeting slides", "Download a deck of the verified minutes."],
      search: ["Ask your meetings", "Search every meeting, with timestamps."],
    },
  },
  {
    id: "law", name: "Law & Auditors", icon: "⚖️", accent: "#1e3a5f",
    tag: "Depositions, hearings and audits",
    orgLabel: "Firm or practice name", orgPlaceholder: "Rao & Partners LLP",
    noun: { one: "hearing", many: "hearings" },
    blurb: "Every statement traceable to the exact moment; low-confidence audio is flagged before it reaches a filing.",
    points: ["Cited transcripts with confidence on each line", "Partner approval before release", "Read-only auditor access to the audit trail"],
    roles: [
      R("partner", "Partner", "🏛️", "review", "admin", "Approve, audit and manage retention"),
      R("associate", "Associate", "💼", "maker", "faculty", "Capture, transcribe, cite and approve"),
      R("auditor", "Auditor", "🔍", "review", "auditor", "Read-only audit trail and approved records"),
      R("client", "Client", "👤", "receiver", "student", "Read released summaries"),
    ],
    words: {
      record: ["Record deposition", "Capture a deposition, hearing or meeting."],
      upload: ["Upload recording", "Add a deposition or hearing recording."],
      notes: ["Verified transcript", "Cited summary with confidence per statement."],
      slides: ["Summary deck", "Download a deck of the verified summary."],
      search: ["Search matters", "Find any statement, cited to the exact moment."],
    },
  },
  {
    id: "med", name: "Healthcare & Medical", icon: "🩺", accent: "#0f766e",
    tag: "Teaching rounds, CME and simulation",
    orgLabel: "Institution name", orgPlaceholder: "City Medical College",
    noun: { one: "round", many: "rounds" },
    blurb: "A wrong flashcard is not an option, so each one is cited, scored and approved by an educator first.",
    points: ["Educators approve before trainees see anything", "Confidence on every flashcard and quiz item", "Consent and audit tools for the compliance team"],
    roles: [
      R("educator", "Clinician-Educator", "🩺", "maker", "faculty", "Record rounds, review and approve"),
      R("trainee", "Trainee", "📖", "receiver", "student", "Study approved teaching material"),
      R("director", "Programme Director", "🏛️", "review", "admin", "Approve, audit and retention"),
      R("compliance", "Compliance Officer", "🛡️", "review", "admin", "Consent, audit and retention"),
    ],
    words: {
      record: ["Record teaching round", "Capture a round or tutorial."],
      upload: ["Upload recording", "Add a round or tutorial recording."],
      notes: ["Case notes", "Cited teaching notes by topic."],
      slides: ["Teaching slides", "Download a deck of the verified notes."],
      search: ["Ask your rounds", "Search every round, with timestamps."],
    },
  },
  {
    id: "train", name: "Training & Coaching", icon: "⚡", accent: "#c2410c",
    tag: "Academies, bootcamps and coaches",
    orgLabel: "Academy or practice name", orgPlaceholder: "Bright Academy",
    noun: { one: "session", many: "sessions" },
    blurb: "Turn every training session into verified course material and release it to learners after approval.",
    points: ["Trainers record sessions and approve material", "Learners get notes, flashcards and quizzes", "Coaches keep session notes per client"],
    roles: [
      R("admin", "Admin", "🛡️", "admin", "admin", "Audit trail, retention and your team"),
      R("trainer", "Trainer", "🎤", "maker", "faculty", "Record, review and approve sessions"),
      R("coach", "Coach", "🧭", "maker", "faculty", "Session notes and exports"),
      R("learner", "Learner", "📖", "receiver", "student", "Study approved material and practice"),
    ],
    words: {
      record: ["Record session", "Capture a live training session."],
      upload: ["Upload session", "Add a session recording."],
      notes: ["Course material", "Cited, verified material for each session."],
      slides: ["Course slides", "Download a deck of the verified material."],
      search: ["Ask your sessions", "Search every session, with timestamps."],
    },
  },
  {
    id: "gov", name: "Government & Public", icon: "🏛️", accent: "#1d4ed8",
    tag: "Hearings, councils and records",
    orgLabel: "Department or agency", orgPlaceholder: "City Planning Office",
    noun: { one: "hearing", many: "hearings" },
    blurb: "Public records with a verifiable source trail and approval before anything is released.",
    points: ["Officers record and approve minutes", "Directors oversee the audit trail", "Auditors get read-only evidence access"],
    roles: [
      R("admin", "Admin", "🛡️", "admin", "admin", "Audit trail, retention and your team"),
      R("director", "Director", "🏛️", "review", "admin", "Approve, audit and retention"),
      R("officer", "Records Officer", "🗂️", "maker", "faculty", "Record hearings and approve minutes"),
      R("auditor", "Auditor", "🔍", "review", "auditor", "Read-only audit trail and approved records"),
    ],
    words: {
      record: ["Record hearing", "Capture a hearing or council meeting."],
      upload: ["Upload recording", "Add a hearing recording."],
      notes: ["Minutes", "Cited, verified minutes by topic."],
      slides: ["Minutes deck", "Download a deck of the verified minutes."],
      search: ["Search records", "Find any statement, cited to the exact moment."],
    },
  },
];

export const DEFAULT_SECTOR = "uni";

export function getSector(id: string | undefined | null): Sector | undefined {
  return SECTORS.find((s) => s.id === id);
}

export function getSectorRole(sectorId: string | undefined | null, roleId: string | undefined | null): SectorRole | undefined {
  return getSector(sectorId)?.roles.find((r) => r.id === roleId);
}

/**
 * Roles a person may pick when creating (`create`) or joining (`join`) an
 * organisation. Keyed on the PERMISSION role, not the title: creating an
 * organisation makes you its administrator (so only admin-level titles are
 * offered), and an invite code never grants admin powers.
 */
export function selectableRoles(sector: Sector, mode: "create" | "join"): SectorRole[] {
  return sector.roles.filter((r) => (mode === "create" ? r.base === "admin" : r.base !== "admin"));
}
