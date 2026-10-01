import { mkdir, writeFile } from "node:fs/promises";

/** Same DATA_DIR resolution as lib/singletons.ts, so media sits beside the DB. */
export function mediaDir(): string {
  const base = process.env.DATA_DIR
    ? process.env.DATA_DIR.replace(/\/?$/, "/")
    : process.cwd() + "/../data/";
  return base + "media/";
}

const MIME_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** Lower-case alphanumeric extension from the filename, else from the MIME type. */
export function mediaExtension(file: File): string {
  const m = /\.([a-zA-Z0-9]{1,5})$/.exec(file.name);
  return (m?.[1] ?? MIME_EXT[file.type] ?? "bin").toLowerCase();
}

/** Deterministic path for a lecture's media file (lectureId is already validated). */
export function mediaPathFor(lectureId: string, file: File): string {
  return `${mediaDir()}${lectureId}.${mediaExtension(file)}`;
}

export async function saveMedia(path: string, file: File): Promise<void> {
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
}

export const MAX_TEXT_CHARS = 200_000;
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "vtt", "srt", "text"]);

/** True when an uploaded file is a plain-text document rather than audio/video. */
export function isTextFile(file: File): boolean {
  return file.type.startsWith("text/") || TEXT_EXTENSIONS.has(mediaExtension(file));
}

/** Deterministic `text://` mediaRef for a lecture's text input. */
export function textRefFor(lectureId: string): string {
  return `text://${mediaDir()}${lectureId}.txt`;
}

export async function saveText(ref: string, text: string): Promise<void> {
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(ref.slice("text://".length), text, "utf8");
}
