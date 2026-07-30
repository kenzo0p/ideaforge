import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Text extraction for uploaded decks and documents.
//
// PPTX is an OOXML zip — slide text lives in <a:t> nodes inside ppt/slides/*.xml,
// so it can be read without a PowerPoint dependency. PDFs go through pdfjs.
// ---------------------------------------------------------------------------

export type DocKind = "pptx" | "pdf";

export interface ExtractedDoc {
  kind: DocKind;
  /** Plain text, one entry per slide (pptx) or page (pdf). */
  sections: string[];
  text: string;
  sectionCount: number;
  truncated: boolean;
}

const MAX_CHARS = 40_000; // keep prompts well inside context limits

export function detectKind(filename: string, mime: string): DocKind | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".pptx") || mime.includes("presentationml")) return "pptx";
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  return null;
}

export async function extractDocument(
  buffer: Buffer,
  kind: DocKind,
): Promise<ExtractedDoc> {
  const sections = kind === "pptx" ? await extractPptx(buffer) : await extractPdf(buffer);

  let text = sections
    .map((s, i) => `--- ${kind === "pptx" ? "Slide" : "Page"} ${i + 1} ---\n${s}`)
    .join("\n\n")
    .trim();

  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS) + "\n\n[…truncated]";

  return { kind, sections, text, sectionCount: sections.length, truncated };
}

/** Slide text from an OOXML presentation, in slide order. */
async function extractPptx(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const out: string[] = [];
  for (const path of slidePaths) {
    const xml = await zip.files[path].async("string");
    // <a:t> holds every run of visible text; <a:p> boundaries become newlines.
    const runs = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    out.push(runs.join(" ").replace(/\s+/g, " ").trim());
  }
  return out;
}

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Page text from a PDF via pdfjs (legacy build runs in Node). */
async function extractPdf(buffer: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // No worker fetch / no system fonts in a server context.
    useWorkerFetch: false,
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
  }
  await doc.cleanup();
  return pages;
}
