import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ---------------------------------------------------------------------------
// Fetching a URL a stranger gave us.
//
// Every check in this product opens pages it was told about. While that was
// gated behind a signed-in session it was a modest risk; the moment anyone can
// paste a URL and have the server fetch it, the endpoint becomes a proxy that
// runs inside our network, and the interesting targets are not on the internet
// at all:
//
//   http://169.254.169.254/latest/meta-data/   cloud instance credentials
//   http://127.0.0.1:27017/                    our own database
//   http://10.0.0.5:6379/                      anything else in the VPC
//
// `fetch(url)` with `redirect: "follow"` reaches all of them, and a public URL
// that 302s to one reaches them while looking perfectly ordinary in a form.
//
// So: resolve the host, refuse every address that is not publicly routable,
// and follow redirects one hop at a time re-checking each. All of it, not just
// the first URL — the redirect is the part people forget.
// ---------------------------------------------------------------------------

export type BlockReason =
  | "scheme"
  | "port"
  | "private-address"
  | "dns"
  | "too-many-redirects";

export interface Blocked {
  reason: BlockReason;
  /** Safe to show a user: never leaks which internal address was resolved. */
  message: string;
}

/** Only the ports a public website answers on. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

const MAX_REDIRECTS = 5;

/**
 * IPv4 ranges that are not publicly routable.
 *
 * Link-local (169.254/16) is the one that matters most and the one most often
 * missed: it holds the cloud metadata service on every major provider, which
 * hands out instance credentials to anything that can make an HTTP request.
 */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — cloud metadata lives here
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const a = v4ToInt(ip);
  const b = v4ToInt(base);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

/**
 * Is this address one we must refuse to open?
 *
 * IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is decoded and re-checked rather than
 * treated as an unfamiliar IPv6 address, because that notation is exactly how a
 * private address gets past a checker that only understands one family.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // unparseable — refuse rather than guess

  if (family === 4) return BLOCKED_V4.some(([base, bits]) => inV4Range(address, base, bits));

  const ip = address.toLowerCase().split("%")[0]; // strip any zone id
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (ip === "::" || ip === "::1") return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;
  return false;
}

/**
 * Check a URL is safe to open, resolving its host first.
 *
 * Every address the name resolves to is checked, not just the first. A host
 * with round-robin DNS that answers with one public and one private address
 * would otherwise pass the check and then be fetched over the private one.
 */
export async function checkUrl(raw: string): Promise<Blocked | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "scheme", message: "Not a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { reason: "scheme", message: "Only http and https URLs can be checked." };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { reason: "port", message: "Only the standard web ports can be checked." };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal IP needs no lookup, and must not get one — resolving it would be
  // a no-op that only widened the code path.
  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { reason: "private-address", message: "That address is not on the public internet." }
      : null;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return { reason: "dns", message: "That hostname could not be resolved." };
  }

  if (addresses.length === 0) return { reason: "dns", message: "That hostname has no address." };
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    // The message deliberately does not say what it resolved to. Reporting the
    // address back would turn this guard into the internal port scanner it
    // exists to prevent.
    return { reason: "private-address", message: "That address is not on the public internet." };
  }
  return null;
}

export interface SafeResponse {
  response: Response;
  /** The URL actually fetched, after redirects. */
  finalUrl: string;
}

/**
 * Fetch, following redirects by hand so every hop is checked.
 *
 * `redirect: "follow"` is the whole vulnerability: it lets a URL that passes
 * inspection hand the connection to one that would not. Each hop is re-checked
 * with the same rules as the first, so a chain ending at the metadata service
 * is refused at the last step rather than the first.
 *
 * KNOWN LIMIT, stated rather than papered over: the address is validated and
 * then the request is made by hostname, so a name that resolves differently
 * between those two moments — a DNS rebinding attack — is not stopped by this.
 * Closing that properly means connecting to the validated IP with an explicit
 * Host header, which needs a custom agent rather than `fetch`. The exposure
 * left is narrow and deliberate; it is not zero.
 */
export async function safeFetch(
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<{ ok: true; value: SafeResponse } | { ok: false; blocked: Blocked }> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await checkUrl(current);
    if (blocked) return { ok: false, blocked };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, { ...init, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      // Relative redirects are normal and must resolve against the hop we are
      // on, not the URL we started from.
      current = new URL(location, current).toString();
      continue;
    }
    return { ok: true, value: { response: res, finalUrl: current } };
  }

  return {
    ok: false,
    blocked: { reason: "too-many-redirects", message: "That URL redirects too many times." },
  };
}
