import { headers } from "next/headers";
import { getMailer } from "./index";

// Builds and sends the "verify your email" message. Returns a dev link only when
// the console mailer is active, so the UI can surface it locally.

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3005";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<{ link: string; delivered: boolean }> {
  const link = `${await baseUrl()}/api/verify-email?token=${token}`;
  const mailer = getMailer();
  const message = {
    to,
    subject: "Verify your IdeaForge email",
    text: `Welcome to IdeaForge! Confirm your email to activate your account:\n\n${link}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
        <h2>Welcome to IdeaForge 🔨</h2>
        <p>Confirm your email to activate your account and start forging ideas.</p>
        <p><a href="${link}" style="display:inline-block;background:#6d4aff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Verify email</a></p>
        <p style="color:#666;font-size:13px">Or paste this link: ${link}<br/>It expires in 24 hours.</p>
      </div>`,
  };

  // Console mailer never "delivers" a real email, so the link is surfaced.
  if (mailer.isConsole) {
    await mailer.send(message);
    return { link, delivered: false };
  }

  // Real mailer: if delivery fails (e.g. Resend test-mode restricts recipients),
  // don't crash signup — return delivered:false so a fallback link can be shown.
  try {
    await mailer.send(message);
    return { link, delivered: true };
  } catch (err) {
    console.error("Verification email failed to send:", err);
    return { link, delivered: false };
  }
}
