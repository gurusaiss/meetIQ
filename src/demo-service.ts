/**
 * Full institutional lifecycle demo (Increment 2), on the SQLite adapter.
 * Shows the compliance gate, faculty approval gate, student visibility,
 * course search, and the audit trail — end to end, zero infra.
 *
 *   npm run demo:service
 */
import { SqliteRepository } from "./persistence/sqlite.ts";
import {
  LectureService,
  ComplianceError,
} from "./services/lecture-service.ts";

function hr(s: string) {
  console.log("\n" + "─".repeat(64) + `\n${s}\n` + "─".repeat(64));
}

const repo = new SqliteRepository(":memory:");
const service = new LectureService(repo);

service.seedInstitution(
  {
    id: "inst-a",
    name: "State University",
    consentPolicy: "all_party", // strictest — like California/Illinois
    dataRegion: "us-east",
    retentionDays: 365,
  },
  { id: "cs101", institutionId: "inst-a", code: "CS101", title: "Data Structures" },
);

hr("COMPLIANCE GATE (moat #2)");
service.createLecture({
  institutionId: "inst-a",
  courseId: "cs101",
  lectureId: "lec-bad",
  mediaRef: "media://x",
  captureSource: "upload",
  consent: { noticeShown: false }, // notice NOT shown
});
try {
  await service.processLecture("inst-a", "lec-bad");
} catch (e) {
  if (e instanceof ComplianceError) {
    console.log("✅ Refused to process (no consent notice):\n   " + e.message);
  } else throw e;
}

hr("HAPPY PATH: create → process");
service.createLecture({
  institutionId: "inst-a",
  courseId: "cs101",
  lectureId: "lec-1",
  mediaRef: "media://hash-tables.mp4",
  captureSource: "echo360-import",
  consent: { noticeShown: true },
});
const assets = await service.processLecture("inst-a", "lec-1", {
  diarize: true,
  speakerHints: { SPEAKER_0: "Prof. Anika", SPEAKER_1: "Student" },
});

hr("FACULTY REVIEW QUEUE (FR-14)");
for (const a of service.reviewQueue("inst-a", "lec-1")) {
  console.log(
    `• ${a.type.padEnd(10)} status=${a.status.padEnd(9)} flagged=${(a.flagRatio * 100).toFixed(0)}%`,
  );
}
console.log(`\nStudent view before approval: ${service.studentAssets("inst-a", "lec-1").length} assets (correct — nothing released yet)`);

hr("FACULTY APPROVES (only faculty/TA may)");
const notes = assets.find((a) => a.type === "notes")!;
service.approveAsset("inst-a", notes.id, { id: "anika", role: "faculty" });
console.log(`Approved "${notes.type}".`);
console.log(`Student view now: ${service.studentAssets("inst-a", "lec-1").map((a) => a.type).join(", ") || "(none)"}`);

hr("STUDENT: chat with the course");
for (const q of ["How are collisions handled?", "When do we resize the table?"]) {
  const [hit] = await service.searchCourse("inst-a", "cs101", q, 1);
  console.log(`\nQ: ${q}`);
  console.log(
    hit
      ? `A: ${hit.chunk.text.slice(0, 110)}...\n   (cite ${hit.chunk.segmentIds.join(",")} @ ${hit.chunk.start.toFixed(0)}s)`
      : "A: (no match)",
  );
}

hr("AUDIT TRAIL (for the security/privacy officer)");
for (const e of repo.listAudit("inst-a")) {
  console.log(`  ${e.ts}  ${e.actor.padEnd(8)} ${e.action.padEnd(18)} ${e.target}`);
}

repo.close();
console.log("\n✅ Lifecycle complete.\n");
