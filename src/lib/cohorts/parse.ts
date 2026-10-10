// ---------------------------------------------------------------------------
// Reading a cohort out of a spreadsheet export.
//
// The submissions a department wants checked are already in a file — a Google
// Sheet, an Excel export, a form's CSV download. Requiring sixty students to
// each sign up and paste their idea is how a tool that would have been useful
// never gets used.
//
// `split(",")` handles none of what those files actually contain. A project
// idea is a sentence, and sentences have commas in them; a title has quotes in
// it; an exported cell can contain a newline. So this is a real CSV reader:
// RFC 4180 quoting, doubled quotes as escapes, embedded newlines, and both
// line-ending conventions — because half these files come off Windows.
// ---------------------------------------------------------------------------

/**
 * Split delimited text into rows of fields.
 *
 * A character-by-character scan rather than a regex. The quoting rules are
 * stateful — whether a comma separates fields depends on whether we are inside
 * quotes, which depends on every quote before it — and a regex that appears to
 * handle that is a regex that handles most of it.
 */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A leading byte-order mark from an Excel export otherwise becomes part of
  // the first header name, and the column is never found.
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quoted) {
      if (ch !== '"') {
        field += ch;
        continue;
      }
      // A doubled quote is a literal quote, not the end of the field.
      if (input[i + 1] === '"') {
        field += '"';
        i++;
        continue;
      }
      quoted = false;
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue; // CRLF: the \n does the work
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  // Whatever is in hand when the input ends is the last field, unless there is
  // nothing at all — a trailing newline must not produce a phantom empty row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Guess the delimiter.
 *
 * People paste tab-separated data far more often than they mean to — it is what
 * copying out of a spreadsheet puts on the clipboard — and telling them their
 * file is malformed when it is merely tabbed is a bad first experience.
 * Decided on the header line only, where the count is unambiguous.
 */
export function sniffDelimiter(text: string): string {
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const tabs = (header.match(/\t/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  const semis = (header.match(/;/g) ?? []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return "\t";
  if (semis > commas) return ";"; // European Excel
  return ",";
}

export interface SubmissionRow {
  studentName: string;
  studentRef: string | null;
  title: string;
  idea: string;
}

export interface ParseResult {
  rows: SubmissionRow[];
  /** Rows that could not be used, with the line number a person can go and fix. */
  skipped: Array<{ line: number; why: string }>;
  /** Which column each field was read from, so a mis-detection is visible. */
  columns: Record<string, string>;
}

/** Header names accepted for each field, in order of preference. */
const HEADERS: Record<keyof SubmissionRow, string[]> = {
  studentName: ["name", "student", "student name", "full name", "submitted by"],
  studentRef: ["roll", "roll no", "roll number", "id", "student id", "reg", "registration", "email"],
  title: ["title", "project", "project title", "topic"],
  idea: ["idea", "description", "abstract", "summary", "problem", "proposal", "synopsis"],
};

function findColumn(header: string[], candidates: string[], taken: Set<number>): number {
  const normalised = header.map((h) =>
    h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, ""),
  );

  // Exact match first: a sheet with both "project" and "project title" should
  // pick the one that was asked for rather than whichever appears earlier.
  for (const want of candidates) {
    const at = normalised.indexOf(want);
    if (at !== -1 && !taken.has(at)) return at;
  }

  // Then whole-word containment. Substring matching is what a first version
  // does and it is wrong in a way real sheets hit immediately: "id" is a
  // substring of "Idea", so a column of project descriptions was being read as
  // the student identifier. A word boundary is the difference.
  for (const want of candidates) {
    const pattern = new RegExp(`(^| )${want.replace(/ /g, " ")}($| )`);
    const at = normalised.findIndex((h) => pattern.test(h));
    if (at !== -1 && !taken.has(at)) return at;
  }
  return -1;
}

/** Shortest text still worth treating as a project idea. */
const MIN_IDEA = 20;

/**
 * Turn a pasted sheet into submissions.
 *
 * Everything that cannot be used is reported with its line number rather than
 * dropped. A silent import that quietly discarded nine of sixty rows would
 * produce a cohort report that looks complete and is not, which is worse than
 * refusing the file.
 */
export function parseSubmissions(text: string): ParseResult {
  const rows = parseDelimited(text, sniffDelimiter(text)).filter((r) =>
    r.some((cell) => cell.trim() !== ""),
  );
  if (rows.length === 0) return { rows: [], skipped: [], columns: {} };

  const header = rows[0];

  // Resolved in priority order, and a column claimed once is not claimed twice.
  // The idea column is the one the whole analysis depends on, so it chooses
  // first; the student reference is the most weakly named and chooses last.
  const taken = new Set<number>();
  const idx = {} as Record<keyof SubmissionRow, number>;
  for (const field of ["idea", "title", "studentName", "studentRef"] as const) {
    const at = findColumn(header, HEADERS[field], taken);
    idx[field] = at;
    if (at !== -1) taken.add(at);
  }

  const skipped: Array<{ line: number; why: string }> = [];

  // Without an idea column there is nothing to compare, and guessing which
  // column holds prose would silently analyse the wrong thing.
  if (idx.idea === -1 && idx.title === -1) {
    return {
      rows: [],
      skipped: [
        {
          line: 1,
          why: `No column recognised as the idea. Name one of them: ${HEADERS.idea.join(", ")}.`,
        },
      ],
      columns: {},
    };
  }

  const out: SubmissionRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cell = (at: number) => (at === -1 ? "" : (row[at] ?? "").trim());

    const idea = cell(idx.idea) || cell(idx.title);
    const title = cell(idx.title) || idea.slice(0, 80);

    if (idea.length < MIN_IDEA) {
      skipped.push({
        line: i + 1,
        why: idea ? `Idea is too short to compare (${idea.length} characters).` : "No idea text.",
      });
      continue;
    }

    out.push({
      studentName: cell(idx.studentName) || "Unnamed",
      studentRef: cell(idx.studentRef) || null,
      title,
      idea,
    });
  }

  const columns: Record<string, string> = {};
  for (const [field, at] of Object.entries(idx)) {
    if (at !== -1) columns[field] = header[at]?.trim() ?? "";
  }

  return { rows: out, skipped, columns };
}


// ---------------------------------------------------------------------------
// And back out again.
//
// A cohort report that can only be read on screen is a report a department head
// cannot circulate, sort, or paste into the spreadsheet the rest of their
// process already lives in. The printable view covers "send this to the
// examiners"; this covers "work with it".
//
// The same quoting rules as the reader, because a report whose own export it
// could not re-read would be an embarrassing thing to ship next to a citation
// checker.
// ---------------------------------------------------------------------------

/** Quote a field if — and only if — it would otherwise be misread. */
function escapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  return rows
    .map((row) => row.map((cell) => escapeField(cell === null ? "" : String(cell))).join(","))
    .join("\r\n");
}
