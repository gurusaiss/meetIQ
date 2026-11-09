/**
 * Transactional email (verification, password reset): the roadmap's last
 * named gap ("email-based verification and self-service reset — needs a mail
 * provider"). Port + adapters, same discipline as every other integration.
 *
 * The Mock provider records sent mail in memory so the flow is fully testable
 * with zero credentials; a real provider is a stub pending API credentials.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  /** Everything ever sent — inspectable in tests, and by the demo UI. */
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }
}

class UnimplementedEmailProvider implements EmailProvider {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  async send(_email: OutgoingEmail): Promise<void> {
    throw new Error(`${this.name} email integration lands with API credentials. Use the mock provider for now.`);
  }
}

export interface ResendCredentials {
  apiKey: string;
  /** A verified sender, e.g. "MeetIQ <noreply@yourdomain.com>". */
  from: string;
}

/**
 * Real Resend connector — a transactional-email API with a single HTTP call
 * and no SMTP setup, a reasonable default for a small/new deployment. Same
 * contract as every other real adapter in this codebase: implemented against
 * Resend's documented API, not yet exercised against a live account (no API
 * key in this environment).
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly creds: ResendCredentials;
  private readonly fetchImpl: typeof fetch;

  constructor(creds: ResendCredentials, fetchImpl: typeof fetch = fetch) {
    if (!creds.apiKey || !creds.from) {
      throw new Error("Resend email provider requires an API key and a from address (RESEND_API_KEY / EMAIL_FROM).");
    }
    this.creds = creds;
    this.fetchImpl = fetchImpl;
  }

  async send(email: OutgoingEmail): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.creds.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.creds.from, to: [email.to], subject: email.subject, text: email.text }),
    });
    if (!res.ok) {
      throw new Error(`Resend rejected the email to ${email.to}: ${res.status} ${await res.text()}`);
    }
  }
}

export function getEmailProvider(name: string, resendCreds?: ResendCredentials): EmailProvider {
  switch (name) {
    case "mock":
      return new MockEmailProvider();
    case "resend":
      if (!resendCreds) throw new Error("Resend email provider selected but no credentials were provided.");
      return new ResendEmailProvider(resendCreds);
    case "ses":
    case "sendgrid":
      return new UnimplementedEmailProvider(name);
    default:
      throw new Error(`Unknown email provider: ${name}`);
  }
}
