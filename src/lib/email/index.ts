// ---------------------------------------------------------------------------
// Email abstraction (same swappable pattern as AI/search providers).
//
// Console mailer (default, zero-config): logs the message + surfaces the link
// locally so verification is completable in dev with no inbox. Resend mailer
// activates when RESEND_API_KEY is set. Feature code calls getMailer().send().
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  readonly id: string;
  /** True when there is no real delivery (dev) — lets the UI reveal the link. */
  readonly isConsole: boolean;
  send(msg: EmailMessage): Promise<void>;
}

class ConsoleMailer implements Mailer {
  readonly id = "console";
  readonly isConsole = true;
  async send(msg: EmailMessage): Promise<void> {
    console.log(
      `\n📧 [ConsoleMailer] To: ${msg.to}\n   Subject: ${msg.subject}\n   ${msg.text}\n`,
    );
  }
}

class ResendMailer implements Mailer {
  readonly id = "resend";
  readonly isConsole = false;
  constructor(
    private readonly apiKey: string,
    private readonly from = process.env.EMAIL_FROM ?? "IdeaForge <onboarding@resend.dev>",
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend send failed (${res.status}): ${detail}`);
    }
  }
}

let cached: Mailer | null = null;

export function getMailer(): Mailer {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  cached = key ? new ResendMailer(key) : new ConsoleMailer();
  return cached;
}
