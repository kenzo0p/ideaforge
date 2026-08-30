// ---------------------------------------------------------------------------
// Splitting a briefing into individual claims.
//
// This is the unglamorous half of claim-level verification, and it is where the
// whole feature succeeds or fails. Attributing a sentence to a source is
// pointless if "costs ₹40.5 crore. [3]" was cut into three fragments, or if a
// heading was scored as a factual assertion.
//
// `text.split(".")` is wrong in at least five ways that occur in ordinary
// output: decimals (2.5%), abbreviations (Dr., et al., vs.), initialisms
// (U.S.), trailing citation markers that sit *after* the full stop, and code or
// URLs that contain dots but no sentences at all.
//
// The approach is to build a *mask* — a copy of the markdown the same length as
// the original, with everything that must not be scanned (code, headings, link
// targets) replaced by spaces. Boundaries are found in the mask; the text is cut
// from the original. Offsets therefore stay valid, and a later feature that
// wants to highlight a claim in place can use them without redoing this work.
// ---------------------------------------------------------------------------

/**
 * Tokens that end in a full stop without ending a sentence.
 *
 * Matched case-insensitively against the word immediately before the stop. The
 * list is deliberately short: every entry is a false-boundary this codebase's
 * own output actually produced, not a general-purpose abbreviation dictionary.
 */
const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st",
  "e.g", "i.e", "eg", "ie", "cf", "vs", "etc", "al", "et",
  "inc", "ltd", "llc", "co", "corp", "dept", "univ", "est",
  "fig", "no", "vol", "pp", "ed", "eds", "approx", "min", "max",
  "rs", "usd", "inr", "jan", "feb", "mar", "apr", "jun", "jul",
  "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** A citation marker: `[3]` or `[2, 5]`. */
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export interface Sentence {
  /** As written, markers included. */
  text: string;
  /** Markers and markdown emphasis removed — what gets embedded. */
  clean: string;
  /** Citation ids this sentence carries, in the order written. */
  citationIds: number[];
  /** Offsets into the markdown this came from. */
  start: number;
  end: number;
}

/** Replace a span with spaces, preserving every offset after it. */
function blank(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) {
    if (chars[i] !== "\n") chars[i] = " ";
  }
}

/**
 * A copy of the markdown with everything unscannable blanked out.
 *
 * Newlines survive because the line-level rules below need them, and because
 * keeping them means a blanked heading still occupies its own line rather than
 * silently joining the paragraphs on either side.
 */
function maskMarkdown(md: string): string {
  const chars = [...md];

  // Fenced code. Dots inside a shell command are not sentence boundaries.
  for (const m of md.matchAll(/```[\s\S]*?(?:```|$)/g)) {
    blank(chars, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  // Inline code spans.
  for (const m of md.matchAll(/`[^`\n]*`/g)) {
    blank(chars, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  // Link and image targets: `[label](https://host/a.b.c)` — the label is prose
  // worth keeping, the URL is a dot farm.
  for (const m of md.matchAll(/\]\((?:[^()\s]|\([^()]*\))*\)/g)) {
    blank(chars, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  // Raw URLs that were never wrapped in markdown.
  for (const m of md.matchAll(/https?:\/\/\S+/g)) {
    blank(chars, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }

  // Line-level structure.
  let offset = 0;
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s/.test(trimmed);
    const isRule = /^([-*_]\s*){3,}$/.test(trimmed);
    // A table's separator row, e.g. `|---|:--:|`.
    const isTableRule = /^\|?[\s:|-]+\|[\s:|-]*$/.test(trimmed) && trimmed.includes("-");

    if (isHeading || isRule || isTableRule) {
      // A heading is a label, not an assertion, and scoring "## Market size"
      // against a source would produce a confident verdict about nothing.
      blank(chars, offset, offset + line.length);
    } else {
      // Keep the content of a list item or quote; drop only the marker, so the
      // bullet cannot be read as the end of the previous sentence.
      const marker = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+|\s*>\s?)/);
      if (marker) blank(chars, offset, offset + marker[0].length);
    }
    offset += line.length + 1;
  }

  return chars.join("");
}

/** The word immediately before a position, lowercased and stripped of punctuation. */
function wordBefore(text: string, dot: number): string {
  let i = dot - 1;
  while (i >= 0 && /[A-Za-z.]/.test(text[i])) i--;
  return text.slice(i + 1, dot).toLowerCase();
}

/**
 * Is the stop at `i` a real sentence boundary?
 *
 * Conservative by design. Splitting one claim into two produces two fragments
 * that each fail to match their source; failing to split merges two claims into
 * one long sentence that still matches the right source. The second error is
 * much cheaper, so ambiguity resolves towards *not* splitting.
 */
function isBoundary(mask: string, i: number): boolean {
  const ch = mask[i];
  if (ch !== "." && ch !== "!" && ch !== "?") return false;

  if (ch === ".") {
    // Decimal or version number: 2.5, 40.3, v1.2
    if (/\d/.test(mask[i - 1] ?? "") && /\d/.test(mask[i + 1] ?? "")) return false;
    // Ellipsis — treat the run as one stop, decided at its last character.
    if (mask[i + 1] === ".") return false;

    const word = wordBefore(mask, i);
    if (ABBREVIATIONS.has(word.replace(/\.$/, ""))) return false;
    // A single letter before a stop is an initial (J. K. Rowling, U.S.).
    if (/^[a-z]$/.test(word)) return false;
  }

  // Consume the whitespace, plus any citation marker sitting between the stop
  // and the next sentence — "…crore. [3] The next claim…" is very common.
  let j = i + 1;
  while (j < mask.length && /\s/.test(mask[j])) j++;
  const marker = /^\[(\d+(?:\s*,\s*\d+)*)\]/.exec(mask.slice(j));
  if (marker) {
    j += marker[0].length;
    while (j < mask.length && /\s/.test(mask[j])) j++;
  }

  if (j >= mask.length) return true;
  // A new sentence starts with a capital, a digit, a quote, or a bullet's
  // content. Anything else is mid-sentence punctuation we misread.
  return /[A-Z0-9"'“‘(*_[]/.test(mask[j]);
}

/** Strip markers, list bullets and emphasis so what gets embedded is the claim itself. */
function cleanForEmbedding(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(MARKER, " ")
    // Leading bullets and ordinals, on every line the sentence spans.
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, " ")
    .replace(/[*_`#>|]+/g, " ")
    .replace(/\s+/g, " ")
    // Removing a marker leaves "annually ." — harmless to read, but it is a
    // token the embedder has to account for and it was never in the prose.
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function markersIn(text: string): number[] {
  const ids: number[] = [];
  for (const m of text.matchAll(MARKER)) {
    for (const raw of m[1].split(",")) {
      const n = Number(raw.trim());
      if (Number.isInteger(n) && !ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}

/**
 * Shortest run of prose still worth treating as a claim.
 *
 * Below this a "sentence" is usually a fragment — a stray "Yes.", a table cell,
 * a label left behind by the mask — and scoring it against a source produces
 * noise rather than a finding.
 */
const MIN_CHARS = 25;

/**
 * The same bar, for a sentence that cites something.
 *
 * Much lower, because the author has already told us it is a claim. "Adoption
 * doubled [4]." is twenty characters and is exactly the kind of assertion this
 * feature exists to check; dropping it for brevity would mean the shortest and
 * boldest claims in a briefing were the ones that silently escaped checking.
 */
const MIN_CHARS_CITED = 12;

export function segment(markdown: string): Sentence[] {
  if (!markdown.trim()) return [];
  const mask = maskMarkdown(markdown);
  const out: Sentence[] = [];

  for (const [start, end] of blocks(markdown, mask)) {
    let from = start;
    for (let i = start; i < end; i++) {
      if (!isBoundary(mask, i)) continue;

      let to = i + 1;
      // Pull a trailing marker into the sentence it belongs to.
      const after = /^[ \t]*\[(\d+(?:\s*,\s*\d+)*)\]/.exec(mask.slice(to, end));
      if (after) to += after[0].length;

      push(markdown, from, to, out);
      from = to;
      i = to - 1;
    }
    push(markdown, from, end, out);
  }

  return out;
}

/** A line that begins a new block regardless of what preceded it. */
function startsBlock(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+|>|#{1,6}\s|\|)/.test(line);
}

/**
 * Contiguous runs of lines that should be scanned together.
 *
 * Blocks matter because most of a briefing's claims are list items, and list
 * items routinely have no terminal punctuation. Scanning the document as one
 * stream merged every bullet into its neighbour; scanning line by line would
 * split a wrapped paragraph mid-sentence. A block is the unit that is neither.
 *
 * A block whose *masked* span is entirely whitespace is dropped — that is how a
 * heading or a table's `|---|` rule stops contributing text, having already
 * been blanked out of the scan.
 */
function blocks(md: string, mask: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const lines = md.split("\n");

  let offset = 0;
  let open: [number, number] | null = null;

  const close = () => {
    if (open && mask.slice(open[0], open[1]).trim()) out.push(open);
    open = null;
  };

  for (const line of lines) {
    const end = offset + line.length;
    const blank = !mask.slice(offset, end).trim();

    if (blank) close();
    else {
      if (startsBlock(line)) close();
      if (open) open[1] = end;
      else open = [offset, end];
    }
    offset = end + 1;
  }
  close();

  return out;
}

function push(md: string, start: number, end: number, out: Sentence[]): void {
  const raw = md.slice(start, end);
  const text = raw.trim();
  if (!text) return;

  const clean = cleanForEmbedding(text);
  const citationIds = markersIn(text);
  // Length is measured on the cleaned text: "[3]" is three characters that say
  // nothing, and a fragment padded out by markers is still a fragment.
  if (clean.length < (citationIds.length > 0 ? MIN_CHARS_CITED : MIN_CHARS)) return;

  const lead = raw.length - raw.trimStart().length;
  out.push({
    text,
    clean,
    citationIds,
    start: start + lead,
    end: start + lead + text.length,
  });
}
