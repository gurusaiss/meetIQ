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

export function getCaptureSource(name: string): CaptureSource {
  switch (name) {
    case "mock":
      return new MockCaptureSource();
    case "echo360":
    case "panopto":
    case "kaltura":
      return new UnimplementedCaptureSource(name);
    default:
      throw new Error(`Unknown capture source: ${name}`);
  }
}
