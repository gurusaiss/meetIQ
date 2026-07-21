/**
 * Lecture ids come straight from a form field and end up in derived asset ids
 * (`${lectureId}:notes:0`), export filenames, and URL segments. Restrict to a
 * safe charset/length at the web boundary rather than trusting free text all
 * the way into storage. Shared by both presentation layers (the zero-dep
 * server and the Next.js app) so the rule can't drift between them.
 */
const LECTURE_ID_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,62}[a-zA-Z0-9])?$/;

export function isValidLectureId(id: string): boolean {
  return LECTURE_ID_RE.test(id);
}
