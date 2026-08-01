import { getMailer } from "./index";
import { publicOrigin } from "@/lib/http/origin";

// Builds and sends the "verify your email" message. Returns a dev link only when
// the console mailer is active, so the UI can surface it locally.

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<{ link: string; delivered: boolean; isConsole: boolean }> {
  const link = `${await publicOrigin()}/reset-password?token=${token}`;
  const mailer = getMailer();
  const message = {
    to,
    subject: "Reset your IdeaForge password",
    text: `Someone requested a password reset for your IdeaForge account.\n\nReset it here:\n${link}\n\nThis link expires in 1 hour. If this wasn't you, ignore this email — nothing has changed.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
        <h2>Reset your password</h2>
        <p>Someone requested a password reset for your IdeaForge account.</p>
        <p><a href="${link}" style="display:inline-block;background:#0d6a6a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Choose a new password</a></p>
        <p style="color:#666;font-size:13px">Or paste this link: ${link}<br/>It expires in 1 hour. If this wasn't you, ignore this email — nothing has changed.</p>
      </div>`,
  };

  if (mailer.isConsole) {
    await mailer.send(message);
    return { link, delivered: false, isConsole: true };
  }
  try {
    await mailer.send(message);
    return { link, delivered: true, isConsole: false };
  } catch (err) {
    console.error("Password reset email failed to send:", err);
    return { link, delivered: false, isConsole: false };
  }
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<{ link: string; delivered: boolean; isConsole: boolean }> {
  const link = `${await publicOrigin()}/api/verify-email?token=${token}`;
  const mailer = getMailer();
  const message = {
    to,
    subject: "Verify your IdeaForge email",
    text: `Welcome to IdeaForge! Confirm your email to activate your account:\n\n${link}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
        <h2>Welcome to IdeaForge 🔨</h2>
        <p>Confirm your email to activate your account and start forging ideas.</p>
        <p><a href="${link}" style="display:inline-block;background:#0d6a6a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Verify email</a></p>
        <p style="color:#666;font-size:13px">Or paste this link: ${link}<br/>It expires in 24 hours.</p>
      </div>`,
  };

  // Console mailer never "delivers" a real email, so the link is surfaced.
  if (mailer.isConsole) {
    await mailer.send(message);
    return { link, delivered: false, isConsole: true };
  }

  // Real mailer: if delivery fails (e.g. Resend test-mode restricts recipients),
  // don't crash signup — return delivered:false so a fallback link can be shown.
  try {
    await mailer.send(message);
    return { link, delivered: true, isConsole: false };
  } catch (err) {
    console.error("Verification email failed to send:", err);
    return { link, delivered: false, isConsole: false };
  }
}

/** Invite someone onto a project. Returns the link so the UI can offer a copy button. */
export async function sendProjectInviteEmail(
  to: string,
  token: string,
  projectTitle: string,
  invitedByName: string,
): Promise<{ link: string; delivered: boolean; isConsole: boolean }> {
  const link = `${await publicOrigin()}/invite/${token}`;
  const mailer = getMailer();
  const message = {
    to,
    subject: `${invitedByName} invited you to "${projectTitle}" on IdeaForge`,
    text: `${invitedByName} invited you to collaborate on "${projectTitle}".\n\nAccept here:\n${link}\n\nThis invitation expires in 7 days.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
        <h2>You've been invited to collaborate</h2>
        <p><strong>${invitedByName}</strong> invited you to work on <strong>${projectTitle}</strong> in IdeaForge.</p>
        <p><a href="${link}" style="display:inline-block;background:#0d6a6a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the project</a></p>
        <p style="color:#666;font-size:13px">Or paste this link: ${link}<br/>It expires in 7 days.</p>
      </div>`,
  };

  if (mailer.isConsole) {
    await mailer.send(message);
    return { link, delivered: false, isConsole: true };
  }
  try {
    await mailer.send(message);
    return { link, delivered: true, isConsole: false };
  } catch (err) {
    console.error("Project invite email failed to send:", err);
    return { link, delivered: false, isConsole: false };
  }
}
