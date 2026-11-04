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

export function getLmsConnector(name: string): LmsConnector {
  switch (name) {
    case "mock":
      return new MockLmsConnector();
    case "canvas":
    case "moodle":
    case "blackboard":
      return new UnimplementedLmsConnector(name);
    default:
      throw new Error(`Unknown LMS connector: ${name}`);
  }
}
