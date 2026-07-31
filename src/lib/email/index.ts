// ---------------------------------------------------------------------------
// Email abstraction (same swappable pattern as AI/search providers).
//
// Three backends, picked automatically:
//   SMTP_HOST set       → SmtpMailer    (Gmail, Brevo, SendGrid, Mailgun, …)
//   RESEND_API_KEY set  → ResendMailer
//   neither             → ConsoleMailer (dev: logs the message, no delivery)
//
// SMTP exists because of a constraint that catches everyone: Resend with no
// verified domain can only deliver to the address that owns the Resend account.
// Providers offering *single sender* verification (Brevo, SendGrid) or plain
// account credentials (Gmail) will mail anyone without owning a domain — and
// they all speak SMTP, so one implementation covers the lot.
//
// Feature code just calls getMailer().send().
// ---------------------------------------------------------------------------

import type { Transporter } from "nodemailer";

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

/**
 * Any SMTP provider. The transport is created once and reused — opening a fresh
 * connection per message is slow and gets you rate-limited.
 */
class SmtpMailer implements Mailer {
  readonly id = "smtp";
  readonly isConsole = false;
  private transport: Transporter | null = null;

  constructor(
    private readonly host: string,
    private readonly port = Number(process.env.SMTP_PORT ?? 587),
    private readonly user = process.env.SMTP_USER,
    private readonly pass = process.env.SMTP_PASSWORD,
    private readonly from = process.env.EMAIL_FROM ??
      `IdeaForge <${process.env.SMTP_USER ?? "no-reply@localhost"}>`,
  ) {}

  private async getTransport(): Promise<Transporter> {
    if (this.transport) return this.transport;
    const { createTransport } = await import("nodemailer");
    this.transport = createTransport({
      host: this.host,
      port: this.port,
      // 465 is implicit TLS; 587 starts plaintext and upgrades via STARTTLS.
      secure: this.port === 465,
      auth: this.user && this.pass ? { user: this.user, pass: this.pass } : undefined,
    });
    return this.transport;
  }

  async send(msg: EmailMessage): Promise<void> {
    const transport = await this.getTransport();
    try {
      await transport.sendMail({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Gmail rejects a normal account password outright; the fix is specific
      // enough to be worth naming rather than surfacing a bare 535.
      if (/invalid login|username and password not accepted|535/i.test(detail)) {
        throw new Error(
          `SMTP login rejected by ${this.host}. For Gmail you must use a 16-character ` +
            `App Password (Google Account → Security → 2-Step Verification → App passwords), ` +
            `not your normal password. Original: ${detail}`,
        );
      }
      throw new Error(`SMTP send failed via ${this.host}: ${detail}`);
    }
  }
}

let cached: Mailer | null = null;

export function getMailer(): Mailer {
  if (cached) return cached;
  // SMTP wins when configured: it's the escape hatch from Resend's
  // no-verified-domain recipient restriction.
  const smtpHost = process.env.SMTP_HOST;
  const resendKey = process.env.RESEND_API_KEY;
  if (smtpHost) cached = new SmtpMailer(smtpHost);
  else if (resendKey) cached = new ResendMailer(resendKey);
  else cached = new ConsoleMailer();
  return cached;
}
