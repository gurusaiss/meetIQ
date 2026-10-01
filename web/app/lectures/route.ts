import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getService, INSTITUTION_ID, COURSE_ID } from "../../lib/singletons.ts";
import { isValidLectureId } from "../../../src/web/lecture-id.ts";
import { ConflictError } from "../../../src/services/lecture-service.ts";
import { htmlError, escapeHtml } from "../../lib/http.ts";
import {
  mediaPathFor,
  saveMedia,
  saveText,
  textRefFor,
  isTextFile,
  MAX_TEXT_CHARS,
} from "../../lib/media.ts";

// Groq Whisper rejects files over 25 MB; fail early with a clear message.
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["faculty", "ta", "admin"])) {
    return new NextResponse("<h1>403 — not permitted for your role</h1>", {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const form = await req.formData();
  const lectureId = String(form.get("lectureId") ?? "").trim();
  if (!lectureId) {
    return new NextResponse("<h1>Missing lecture id</h1>", {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (!isValidLectureId(lectureId)) {
    return new NextResponse(
      "<h1>Invalid lecture id</h1><p>Use 1-64 characters: letters, digits, dot, dash, underscore; must start and end with a letter or digit.</p>",
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const upload = form.get("media");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  const pasted = String(form.get("text") ?? "").trim();

  // Input kinds: pasted text, an uploaded text file, or an audio/video file.
  let text: string | null = pasted || null;
  let media: File | null = null;
  if (file && isTextFile(file)) {
    if (file.size > MAX_TEXT_CHARS * 4) {
      return htmlError(413, `<h1>Text file too large</h1><p><a href="/new">← Back</a></p>`);
    }
    text = text ?? (await file.text()).trim();
  } else if (file) {
    media = file;
  }
  if (String(form.get("kind") ?? "") === "text" && text === null) {
    return htmlError(400, `<h1>No text provided</h1><p>Paste some text or choose a text file.</p><p><a href="/new?mode=text">← Back</a></p>`);
  }
  if (text !== null && text.length > MAX_TEXT_CHARS) {
    return htmlError(
      413,
      `<h1>Text too long</h1><div class="notice">Limit is ${MAX_TEXT_CHARS.toLocaleString()} characters.</div><p><a href="/new">← Back</a></p>`,
    );
  }
  if (media && media.size > MAX_MEDIA_BYTES) {
    return htmlError(
      413,
      `<h1>Recording too large</h1><div class="notice">Uploads are limited to 25 MB (about 25 minutes of compressed audio).</div><p><a href="/new">← Back</a></p>`,
    );
  }
  // text -> text:// ref (saved after create); media -> real path; nothing -> placeholder (mock path).
  const mediaRef = media
    ? mediaPathFor(lectureId, media)
    : text !== null
      ? textRefFor(lectureId)
      : `media://${lectureId}`;

  try {
    await getService().createLecture({
      institutionId: INSTITUTION_ID,
      courseId: COURSE_ID,
      lectureId,
      mediaRef,
      captureSource: String(form.get("captureSource") ?? "upload"),
      consent: { noticeShown: form.get("noticeShown") === "on" },
    });
  } catch (e) {
    if (e instanceof ConflictError) {
      return htmlError(
        409,
        `<h1>Lecture already exists</h1><div class="notice">${escapeHtml(e.message)}</div><p><a href="/">← Dashboard</a></p>`,
      );
    }
    throw e;
  }
  // Written after createLecture so a duplicate id (409) never overwrites an existing input.
  if (media) await saveMedia(mediaRef, media);
  else if (text !== null) await saveText(mediaRef, text);

  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
