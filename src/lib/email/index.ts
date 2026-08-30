// ---------------------------------------------------------------------------
// Email abstraction (same swappable pattern as AI/search providers).
//
// Two backends:
//   SMTP_HOST set → SmtpMailer    (Gmail, Brevo, SendGrid, Mailgun, …)
//   otherwise     → ConsoleMailer (logs the message, no delivery)
//
// Resend was removed: it can only mail the account owner until you verify a
// domain, which made it useless for inviting anyone. Collaboration no longer
// touches email at all — invitations are delivered in-app by username — so the
// mailer is now optional, used only for password resets when SMTP is set up.
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

/**
 * Any SMTP provider. The transport is created once and reused — opening a fresh
 * connection per message is slow and gets you rate-limited.
 */
class SmtpMailer implements Mailer {
  readonly id = "smtp";
  readonly isConsole = false;
  private transport: Transporter | null = null;

  private readonly host: string;
  private readonly port: number;
  private readonly user?: string;
  private readonly pass?: string;
  private readonly from: string;

  constructor(
    host: string,
    port = Number(process.env.SMTP_PORT ?? 587),
    user = process.env.SMTP_USER,
    pass = process.env.SMTP_PASSWORD,
    from = process.env.EMAIL_FROM ??
      `Scrutan <${process.env.SMTP_USER ?? "no-reply@localhost"}>`,
  ) {
    this.host = host;
    this.port = port;
    this.user = user;
    this.pass = pass;
    this.from = from;
  }

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
  const smtpHost = process.env.SMTP_HOST;
  cached = smtpHost ? new SmtpMailer(smtpHost) : new ConsoleMailer();
  return cached;
}
