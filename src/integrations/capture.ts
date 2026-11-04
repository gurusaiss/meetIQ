/**
 * Capture-source integration (moat #4): import recordings from the systems
 * universities already own (Echo360 ~30%, Panopto ~25%, Kaltura) rather than
 * rebuilding capture. Port + adapters, same discipline as AI/storage.
 *
 * The Mock adapter returns fixture recordings so the import flow is testable
 * with zero credentials; real adapters are stubs pending API keys.
 */
export interface ExternalRecording {
  externalId: string;
  title: string;
  durationSec: number;
  capturedAt: string;
  /** Where the media lives in the source system. */
  mediaRef: string;
  /**
   * Whether the capture system already recorded consent at capture time.
   * Echo360/Panopto deployments typically handle room-consent policy; we
   * carry that assertion so the downstream compliance gate is satisfied
   * honestly rather than blindly.
   */
  consentCaptured: boolean;
}

export interface CaptureSource {
  readonly name: string;
  listRecordings(externalCourseId: string): Promise<ExternalRecording[]>;
}

export class MockCaptureSource implements CaptureSource {
  readonly name = "mock";
  async listRecordings(externalCourseId: string): Promise<ExternalRecording[]> {
    return [
      {
        externalId: `${externalCourseId}-rec-101`,
        title: "Hash Tables",
        durationSec: 98,
        capturedAt: "2026-01-15T10:00:00.000Z",
        mediaRef: "echo360://rec-101.mp4",
        consentCaptured: true,
      },
      {
        externalId: `${externalCourseId}-rec-102`,
        title: "Balanced Trees",
        durationSec: 105,
        capturedAt: "2026-01-17T10:00:00.000Z",
        mediaRef: "echo360://rec-102.mp4",
        consentCaptured: true,
      },
    ];
  }
}

class UnimplementedCaptureSource implements CaptureSource {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  async listRecordings(_externalCourseId: string): Promise<ExternalRecording[]> {
    throw new Error(
      `${this.name} capture integration lands with API credentials (Increment 6+). Use the mock source for now.`,
    );
  }
}

export interface ZoomCredentials {
  /** Server-to-Server OAuth app credentials (Zoom App Marketplace). */
  accountId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Real Zoom Cloud Recordings capture source — the company/meeting-recording
 * equivalent of Echo360/Panopto (lecture capture), and the most broadly
 * useful of the three since every sector this app serves already has Zoom
 * recordings (meetings, classes, depositions, training sessions).
 *
 * Auth: Server-to-Server OAuth (account_id + client_id + client_secret from
 * a Zoom App Marketplace app), not the old deprecated JWT apps. The access
 * token is cached and refreshed a little before it actually expires.
 *
 * Same contract as every other provider in this codebase: implemented
 * against Zoom's real REST API, but not yet exercised against a live
 * account (no credentials available in this environment) — see the
 * Anthropic/Groq providers' doc comments for the same caveat.
 */
export class ZoomCaptureSource implements CaptureSource {
  readonly name = "zoom";
  private readonly creds: ZoomCredentials;
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(creds: ZoomCredentials, fetchImpl: typeof fetch = fetch) {
    if (!creds.accountId || !creds.clientId || !creds.clientSecret) {
      throw new Error(
        "Zoom capture source requires accountId, clientId and clientSecret " +
          "(ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET) from a Server-to-Server OAuth app.",
      );
    }
    this.creds = creds;
    this.fetchImpl = fetchImpl;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 30_000) return this.token.value;

    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(this.creds.accountId)}`,
      { method: "POST", headers: { authorization: `Basic ${basic}` } },
    );
    if (!res.ok) {
      throw new Error(`Zoom OAuth token request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return json.access_token;
  }

  /**
   * `externalCourseId` is reused here as the Zoom user id/email whose cloud
   * recordings to list ("me" for the token's own account, or an explicit
   * user id/email for someone else's) — the same parameter Echo360/Panopto
   * use for "which course", just meaning "which user" for Zoom.
   */
  async listRecordings(externalCourseId: string): Promise<ExternalRecording[]> {
    const userId = externalCourseId || "me";
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(
      `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/recordings?page_size=50`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Zoom recordings request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      meetings?: Array<{
        id: number | string;
        topic: string;
        start_time: string;
        duration: number;
        recording_files?: Array<{ id: string; file_type: string; download_url: string; recording_type: string }>;
      }>;
    };

    const out: ExternalRecording[] = [];
    for (const m of json.meetings ?? []) {
      // Prefer the combined gallery/speaker view; fall back to any video,
      // then any audio-only file.
      const file =
        m.recording_files?.find((f) => f.recording_type === "shared_screen_with_speaker_view" && f.file_type === "MP4") ??
        m.recording_files?.find((f) => f.file_type === "MP4") ??
        m.recording_files?.find((f) => f.file_type === "M4A");
      if (!file) continue;
      out.push({
        externalId: `zoom-${m.id}-${file.id}`,
        title: m.topic,
        durationSec: Math.round(m.duration * 60),
        capturedAt: m.start_time,
        // Zoom's cloud-recording download URLs are only valid with the same
        // bearer token used to list them. A production implementation would
        // fetch the media server-side within the token's lifetime (or mint
        // a short-lived signed URL) rather than persist a token in mediaRef;
        // this is good enough to demonstrate the real API shape end-to-end.
        mediaRef: `${file.download_url}?access_token=${encodeURIComponent(token)}`,
        // Zoom doesn't hand back a structured "consent was captured" flag the
        // way a room-capture appliance might — default to false (not
        // consented) rather than asserting something never actually
        // verified. A real deployment would set this from the org's own
        // recording-disclosure/consent workflow, not guess it here.
        consentCaptured: false,
      });
    }
    return out;
  }
}

export function getCaptureSource(
  name: string,
  zoomCreds?: ZoomCredentials,
): CaptureSource {
  switch (name) {
    case "mock":
      return new MockCaptureSource();
    case "zoom":
      if (!zoomCreds) throw new Error("Zoom capture source selected but no credentials were provided.");
      return new ZoomCaptureSource(zoomCreds);
    case "echo360":
    case "panopto":
    case "kaltura":
      return new UnimplementedCaptureSource(name);
    default:
      throw new Error(`Unknown capture source: ${name}`);
  }
}
