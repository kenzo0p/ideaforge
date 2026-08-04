// ---------------------------------------------------------------------------
// Email-domain policy for organisations.
//
// Domain matching is how someone joins an institution without an invitation:
// sign up with an @iitb.ac.in address and you land in that workspace. It is
// also the single most dangerous thing in the org feature, because a domain
// claim is an assertion about people who haven't signed up yet.
//
// Two rules make it safe:
//   1. A domain can only be claimed by someone whose own verified email is on
//      it. You cannot claim a domain you don't already belong to.
//   2. Consumer mail providers can never be claimed. Without this, one person
//      claiming gmail.com would silently adopt most of the user base.
// ---------------------------------------------------------------------------

/**
 * Mailbox providers open to the public.
 *
 * These are shared address spaces: belonging to one says nothing about which
 * organisation you belong to. The list only has to cover providers real users
 * actually arrive with — anything missed is still caught by rule 1 above,
 * which limits the blast radius to that provider's own users.
 */
const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "mail.ru",
  "duck.com",
  "rediffmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "foxmail.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "example.com",
]);

/** Lowercased domain part of an address, or null when it isn't one. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  // A bare hostname with no dot can't be a real mail domain, and would let
  // "localhost" or a typo match far more broadly than intended.
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;
  if (/[^a-z0-9.-]/.test(domain)) return null;
  return domain;
}

/** True when the domain is a public mailbox provider and must never be claimed. */
export function isPublicDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.has(domain.toLowerCase());
}

/**
 * Check a domain claim against the claimant's own address.
 *
 * Returns null when the claim is allowed, or the reason to show when it isn't.
 * Subdomains of the claimant's domain are permitted (`cse.iitb.ac.in` from
 * `@iitb.ac.in`) because departments routinely issue their own addresses; the
 * reverse is not, or a student on a department domain could claim the whole
 * institution.
 */
export function rejectDomainClaim(claim: string, claimantEmail: string): string | null {
  const domain = domainOf(`x@${claim}`);
  if (!domain) return "That doesn't look like a valid email domain.";
  if (isPublicDomain(domain)) {
    return `${domain} is a public email provider — anyone could join. Use your institution's own domain.`;
  }

  const own = domainOf(claimantEmail);
  if (!own) return "Your account has no usable email domain.";
  if (domain === own) return null;
  if (domain.endsWith(`.${own}`)) return null;

  return `You can only claim ${own} or a subdomain of it, because that's the domain your own address is on.`;
}
