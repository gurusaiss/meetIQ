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

export function getLmsConnector(
  name: string,
  slackCreds?: SlackCredentials,
): LmsConnector {
  switch (name) {
    case "mock":
      return new MockLmsConnector();
    case "slack":
      if (!slackCreds) throw new Error("Slack connector selected but no credentials were provided.");
      return new SlackLmsConnector(slackCreds);
    case "canvas":
    case "moodle":
    case "blackboard":
      return new UnimplementedLmsConnector(name);
    default:
      throw new Error(`Unknown LMS connector: ${name}`);
  }
}
