import { hamming, isNearDuplicate, simhash, toHex, type Fingerprint } from "./simhash";
import type { Citation } from "@/lib/pipeline/types";

// ---------------------------------------------------------------------------
// "Twelve citations" is not "twelve sources".
//
// This is the failure mode of every AI research tool including, until now, this
// one. A briefing lists a dozen numbered references and reads as though a dozen
// independent parties have looked at the question. Frequently they have not:
// six of them are the same press release reprinted across trade sites, three
// are different pages on one vendor's own domain, and the actual number of
// people who investigated anything is two.
//
// Nobody measures this, which is odd, because the count of *independent*
// sources is the number that decides how much a briefing is worth. Two ways a
// citation list collapses, and both are checkable without a model:
//
//   same publisher    two URLs on one registrable domain are one voice, however
//                     many pages they occupy
//   same text         the same content republished elsewhere is one voice
//                     wearing two domain names (simhash.ts)
//
// What comes out is a count, a concentration figure, and the specific groups —
// so a reader can see that their twelve references are five sources and which
// six of them trace to one origin.
// ---------------------------------------------------------------------------

/**
 * Multi-part public suffixes, so `bbc.co.uk` reduces to `bbc.co.uk` rather than
 * to `co.uk`.
 *
 * A curated subset rather than the full Public Suffix List, which is ten
 * thousand entries and a build-time dependency. The failure direction matters:
 * a suffix missing from this list makes two unrelated sites on it look like one
 * publisher, which *understates* independence. That is the safer error — it
 * tells someone their evidence is narrower than it is rather than broader — but
 * it is still an error, and the list should grow when one is found.
 */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "net.uk", "sch.uk", "nhs.uk",
  "co.in", "org.in", "ac.in", "gov.in", "net.in", "edu.in", "res.in", "nic.in", "firm.in",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au",
  "co.nz", "org.nz", "govt.nz", "ac.nz",
  "co.za", "org.za", "gov.za", "ac.za",
  "com.br", "org.br", "gov.br", "edu.br",
  "com.cn", "net.cn", "org.cn", "edu.cn", "gov.cn", "ac.cn",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "co.kr", "or.kr", "ne.kr", "go.kr", "re.kr",
  "com.sg", "edu.sg", "gov.sg", "com.my", "edu.my", "gov.my",
  "com.hk", "edu.hk", "gov.hk", "com.tw", "edu.tw", "gov.tw",
  "com.mx", "com.ar", "com.tr", "edu.tr", "gov.tr",
  "co.il", "ac.il", "org.il", "gov.il",
  "com.pk", "edu.pk", "gov.pk", "com.bd", "com.np", "com.lk",
]);

/**
 * The domain a URL's publisher is identified by.
 *
 * `blog.example.co.uk/a` and `shop.example.co.uk/b` are the same publisher;
 * `example.com` and `other.com` are not. Subdomains are dropped because a
 * publisher's structure is its own business — a company citing its own blog,
 * docs and newsroom is citing itself three times.
 */
export function registrableDomain(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
  const parts = host.split(".");
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo)
    ? parts.slice(-3).join(".")
    : lastTwo;
}

/** Why two citations were judged to be one voice. */
export type LinkReason = "same-publisher" | "republished-text";

export interface SourceGroup {
  /** Citation ids that collapse to a single independent source. */
  citationIds: number[];
  /**
   * Every reason that applies, not just one.
   *
   * A group can form both ways at once — two pages on a vendor's own domain
   * plus a trade site that reprinted one of them — and naming a single cause
   * would tell the reader a true thing that leaves out the other true thing.
   */
  reasons: LinkReason[];
  /** The shared domain, when a same-publisher link contributed. */
  domain: string | null;
  /** Closest Hamming distance found, when a republished-text link contributed. */
  bitsApart: number | null;
}

export interface IndependenceReport {
  /** How many citations the briefing carries. */
  citations: number;
  /** Distinct registrable domains among them. */
  domains: number;
  /** Independent voices, after collapsing publishers and republications. */
  independent: number;
  /**
   * Normalised Shannon entropy of the domain distribution, 0–1.
   *
   * 1 means every citation came from a different publisher; 0 means they all
   * came from one. Reported alongside the counts rather than instead of them,
   * because an entropy figure on its own is not something a student can act on.
   */
  entropy: number;
  /** Publishers with more than one citation, most-cited first. */
  concentration: Array<{ domain: string; count: number }>;
  /** The groups that collapsed. Singletons are not listed. */
  groups: SourceGroup[];
  /** Citations whose text could not be read, so only their domain was used. */
  unread: number;
  checkedAt: number;
}

/**
 * Shannon entropy of the publisher distribution, normalised to 0–1.
 *
 * Normalised by log2(n) — the entropy of n citations from n different
 * publishers — so the figure means the same thing for a briefing with six
 * references and one with twenty. Without that, a longer briefing would always
 * look more diverse simply for being longer.
 */
function normalisedEntropy(counts: number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n <= 1) return 1;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / n;
    h -= p * Math.log2(p);
  }
  const max = Math.log2(n);
  return max === 0 ? 1 : Number((h / max).toFixed(3));
}

export interface ReadSource {
  citation: Citation;
  /** Page text, or "" when it could not be read. */
  text: string;
}

/**
 * How many independent voices are actually behind a citation list.
 *
 * Works from whatever was read: a source whose page could not be fetched still
 * contributes its domain, because a publisher is identifiable from a URL alone.
 * Only the republished-text check needs the body.
 */
export function assessIndependence(sources: ReadSource[]): IndependenceReport {
  const now = Date.now();
  const empty: IndependenceReport = {
    citations: 0, domains: 0, independent: 0, entropy: 1,
    concentration: [], groups: [], unread: 0, checkedAt: now,
  };
  if (sources.length === 0) return empty;

  const ids = sources.map((s) => s.citation.id);
  const domains = sources.map((s) => registrableDomain(s.citation.url));

  // Union-find over the citations. Two citations are linked when they share a
  // publisher or when their text is a republication of one another; the
  // transitive closure is one independent source.
  const parent = sources.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const reasons = new Map<string, { reason: LinkReason; domain: string | null; bits: number | null }>();
  const union = (a: number, b: number, info: { reason: LinkReason; domain: string | null; bits: number | null }) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent[rb] = ra;
    reasons.set(`${Math.min(a, b)}:${Math.max(a, b)}`, info);
  };

  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      if (domains[i] && domains[i] === domains[j]) {
        union(i, j, { reason: "same-publisher", domain: domains[i], bits: null });
      }
    }
  }

  // Republication: only worth testing between different publishers. Two pages
  // on one domain being similar is not a finding, it is a website.
  const prints = new Map<number, Fingerprint>();
  for (let i = 0; i < sources.length; i++) {
    if (sources[i].text) prints.set(i, simhash(sources[i].text));
  }
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      if (domains[i] === domains[j]) continue;
      const a = prints.get(i);
      const b = prints.get(j);
      if (!a || !b) continue;
      if (isNearDuplicate(a, b)) {
        union(i, j, { reason: "republished-text", domain: null, bits: hamming(a, b) });
      }
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < sources.length; i++) {
    const root = find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), i]);
  }

  const groups: SourceGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;

    const applied = new Set<LinkReason>();
    let domain: string | null = null;
    let bits: number | null = null;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const key = `${Math.min(members[a], members[b])}:${Math.max(members[a], members[b])}`;
        const found = reasons.get(key);
        if (!found) continue;
        applied.add(found.reason);
        if (found.domain) domain = found.domain;
        // The closest pair is the most convincing evidence of republication.
        if (found.bits !== null && (bits === null || found.bits < bits)) bits = found.bits;
      }
    }

    groups.push({
      citationIds: members.map((i) => ids[i]).sort((x, y) => x - y),
      reasons: [...applied].sort(),
      domain,
      bitsApart: bits,
    });
  }
  groups.sort((a, b) => b.citationIds.length - a.citationIds.length);

  const perDomain = new Map<string, number>();
  for (const d of domains) if (d) perDomain.set(d, (perDomain.get(d) ?? 0) + 1);

  return {
    citations: sources.length,
    domains: perDomain.size,
    independent: byRoot.size,
    entropy: normalisedEntropy([...perDomain.values()]),
    concentration: [...perDomain]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count })),
    groups,
    unread: sources.filter((s) => !s.text).length,
    checkedAt: now,
  };
}

/** One sentence a reader can act on, or null when the list is already diverse. */
export function independenceSentence(report: IndependenceReport): string | null {
  if (report.citations === 0) return null;
  if (report.independent === report.citations) {
    return `All ${report.citations} citations come from separate, independent sources.`;
  }
  const collapsed = report.citations - report.independent;
  return (
    `${report.citations} citations, but ${report.independent} independent ` +
    `${report.independent === 1 ? "source" : "sources"} — ` +
    `${collapsed} ${collapsed === 1 ? "is" : "are"} the same publisher or the same text republished.`
  );
}

export { toHex };
