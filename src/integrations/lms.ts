/**
 * LMS push integration (moat #4): deliver approved knowledge assets into the
 * LMS students already live in (Canvas/Moodle/Blackboard) — no new app to
 * adopt (Phase 9 principle). Port + adapters.
 *
 * The Mock connector records pushes in memory so the flow is testable; real
 * connectors are stubs pending API credentials / LTI registration.
 */
export interface LmsItem {
  lectureId: string;
  type: string;
  title: string;
  /** Rendered body (e.g. Markdown notes / quiz, or CSV). */
  body: string;
  contentType: string;
}

export interface LmsConnector {
  readonly name: string;
  publish(externalCourseId: string, items: LmsItem[]): Promise<number>;
  /** Everything ever pushed this process's lifetime, for a running "total published" count. Optional — not every connector tracks it. */
  readonly published?: Array<{ externalCourseId: string; item: LmsItem }>;
}

export class MockLmsConnector implements LmsConnector {
  readonly name = "mock";
  /** Everything ever pushed — inspectable in tests / demo. */
  readonly published: Array<{ externalCourseId: string; item: LmsItem }> = [];

  async publish(externalCourseId: string, items: LmsItem[]): Promise<number> {
    for (const item of items) this.published.push({ externalCourseId, item });
    return items.length;
  }
}

class UnimplementedLmsConnector implements LmsConnector {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  async publish(_externalCourseId: string, _items: LmsItem[]): Promise<number> {
    throw new Error(
      `${this.name} LMS integration lands with LTI/API credentials. Use the mock connector for now.`,
    );
  }
}

export interface SlackCredentials {
  /** An Incoming Webhook URL for the destination channel (Slack App → Incoming Webhooks). */
  webhookUrl: string;
}

/** Slack's hard limit on a single message `text` field is ~4000 chars; stay well under it. */
const SLACK_BODY_LIMIT = 2800;

/**
 * Real Slack connector — the distribution/"publish" counterpart to the LMS
 * adapters (Canvas/Moodle/Blackboard are education-specific; companies
 * don't have an LMS, they have a channel). Posts each approved item as its
 * own message via an Incoming Webhook, so minutes/decisions land exactly
 * where a team already reads them, no new app to adopt.
 *
 * Same contract as every other provider in this codebase: implemented
 * against Slack's real webhook API, but not yet exercised against a live
 * workspace (no webhook URL available in this environment).
 */
export class SlackLmsConnector implements LmsConnector {
  readonly name = "slack";
  /** Everything ever pushed — inspectable in tests / demo, same as Mock. */
  readonly published: Array<{ externalCourseId: string; item: LmsItem }> = [];
  private readonly creds: SlackCredentials;
  private readonly fetchImpl: typeof fetch;

  constructor(creds: SlackCredentials, fetchImpl: typeof fetch = fetch) {
    if (!creds.webhookUrl) {
      throw new Error("Slack connector requires a webhook URL (SLACK_WEBHOOK_URL).");
    }
    this.creds = creds;
    this.fetchImpl = fetchImpl;
  }

  async publish(externalCourseId: string, items: LmsItem[]): Promise<number> {
    let count = 0;
    for (const item of items) {
      const body = item.body.length > SLACK_BODY_LIMIT
        ? `${item.body.slice(0, SLACK_BODY_LIMIT)}\n…(truncated — see MeetIQ for the full item)`
        : item.body;
      const res = await this.fetchImpl(this.creds.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `*${item.title}*\n${body}` }),
      });
      if (!res.ok) {
        throw new Error(
          `Slack webhook rejected ${item.type} for ${item.lectureId}: ${res.status} ${await res.text()}`,
        );
      }
      count++;
      this.published.push({ externalCourseId, item });
    }
    return count;
  }
}

export interface CanvasCredentials {
  /** Your institution's Canvas host, e.g. https://yourschool.instructure.com (https only). */
  baseUrl: string;
  /** An API access token (Account → Settings → New Access Token), or a developer-key token. */
  accessToken: string;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Canvas wiki pages are HTML, our exporters emit Markdown. This converts the
 * small subset the exporters actually produce (headings, bullets, checkboxes,
 * bold, italics, rules). Everything is HTML-escaped FIRST: the text comes from
 * transcripts, i.e. from whatever was said in a room, and must never be able
 * to inject markup into a page students will open.
 */
export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    escHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_(.+?)_(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push("</ul>");
    inList = false;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      closeList();
      continue;
    }
    const bullet = line.match(/^- (\[ \] )?(.*)$/);
    if (bullet) {
      if (!inList) out.push("<ul>");
      inList = true;
      out.push(`<li>${bullet[1] ? "☐ " : ""}${inline(bullet[2]!)}</li>`);
      continue;
    }
    closeList();
    const h = line.match(/^(#{1,3}) (.*)$/);
    if (h) out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
    else if (/^-{3,}$/.test(line)) out.push("<hr>");
    else out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

/** "my lecture_1" → "meetiq-my-lecture-1-notes": a stable page slug so re-publishing updates in place. */
function canvasSlug(item: LmsItem): string {
  const clean = `${item.lectureId}-${item.type}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `meetiq-${clean}`;
}

/**
 * Real Canvas LMS connector (the university counterpart to Slack): publishes
 * each approved item as a Canvas wiki Page in the course, through Canvas's
 * REST API with a Bearer access token. Idempotent — each item has a stable
 * slug, so publishing again updates the page rather than creating duplicates
 * (PUT creates-or-updates; if a Canvas build answers 404 to a PUT for a page
 * that doesn't exist yet, we fall back to an explicit create).
 *
 * `externalCourseId` is a numeric Canvas course id, or anything else, which is
 * treated as an SIS course id (`sis_course_id:<id>`), the form registrars use.
 *
 * Pages are created PUBLISHED: "Publish approved" is the faculty's explicit
 * release, and the approval gate has already run before anything gets here.
 *
 * Same contract as the other real adapters: implemented against Canvas's
 * documented API, not yet exercised against a live Canvas (no institution
 * credentials in this environment).
 */
export class CanvasLmsConnector implements LmsConnector {
  readonly name = "canvas";
  readonly published: Array<{ externalCourseId: string; item: LmsItem }> = [];
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(creds: CanvasCredentials, fetchImpl: typeof fetch = fetch) {
    if (!creds.baseUrl || !creds.accessToken) {
      throw new Error("Canvas connector requires CANVAS_BASE_URL and CANVAS_ACCESS_TOKEN.");
    }
    if (!/^https:\/\//i.test(creds.baseUrl)) {
      throw new Error("CANVAS_BASE_URL must start with https:// (the access token is sent to it).");
    }
    this.base = creds.baseUrl.replace(/\/+$/, "");
    this.token = creds.accessToken;
    this.fetchImpl = fetchImpl;
  }

  async publish(externalCourseId: string, items: LmsItem[]): Promise<number> {
    const courseRef = /^\d+$/.test(externalCourseId) ? externalCourseId : `sis_course_id:${externalCourseId}`;
    const coursePath = `${this.base}/api/v1/courses/${encodeURIComponent(courseRef)}/pages`;
    let count = 0;
    for (const item of items) {
      const form = new URLSearchParams({
        "wiki_page[title]": item.title,
        "wiki_page[body]": item.contentType === "text/csv" ? `<pre>${escHtml(item.body)}</pre>` : markdownToHtml(item.body),
        "wiki_page[published]": "true",
      });
      const headers = { authorization: `Bearer ${this.token}`, "content-type": "application/x-www-form-urlencoded" };

      let res = await this.fetchImpl(`${coursePath}/${canvasSlug(item)}`, { method: "PUT", headers, body: form });
      if (res.status === 404) {
        res = await this.fetchImpl(coursePath, { method: "POST", headers, body: form });
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`Canvas rejected ${item.type} for ${item.lectureId}: ${res.status} ${detail}`);
      }
      count++;
      this.published.push({ externalCourseId, item });
    }
    return count;
  }
}

export function getLmsConnector(
  name: string,
  slackCreds?: SlackCredentials,
  canvasCreds?: CanvasCredentials,
): LmsConnector {
  switch (name) {
    case "mock":
      return new MockLmsConnector();
    case "slack":
      if (!slackCreds) throw new Error("Slack connector selected but no credentials were provided.");
      return new SlackLmsConnector(slackCreds);
    case "canvas":
      if (!canvasCreds) throw new Error("Canvas connector selected but no credentials were provided.");
      return new CanvasLmsConnector(canvasCreds);
    case "moodle":
    case "blackboard":
      return new UnimplementedLmsConnector(name);
    default:
      throw new Error(`Unknown LMS connector: ${name}`);
  }
}
