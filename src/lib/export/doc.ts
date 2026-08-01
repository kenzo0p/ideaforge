import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { ProjectPlan, ResearchReport } from "@/lib/insights/types";

// ---------------------------------------------------------------------------
// Word (.docx) export.
//
// The point of this format is that it's editable — a judge or teammate opens it
// and rewrites a paragraph. So it uses real Word structure (heading styles,
// tables, hyperlinks) rather than a wall of pre-formatted text: styled headings
// give a working navigation pane and let restyling the whole document be one
// click.
//
// Colours mirror the light-theme tokens in globals.css. Word has no CSS
// variables, so like the PPTX exporter they're duplicated here and have to be
// updated by hand when the palette changes.
// ---------------------------------------------------------------------------

const BRAND = "0D6A6A"; // --brand-solid
const INK = "12201F"; // --foreground
const MUTED = "4B5A58"; // --muted
const HAIRLINE = "E0E0D8"; // --border

export interface DocInput {
  title: string;
  idea: string;
  createdAt?: number;
  validationMarkdown?: string | null;
  research?: ResearchReport | null;
  plan?: ProjectPlan | null;
}

/** Strip the markdown the model emits so it doesn't show up as literal `**`. */
function plain(md: string): string {
  return md
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

const H1 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, bold: true, size: 32, color: BRAND })],
  });

const H2 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, color: INK })],
  });

const P = (text: string, opts: { color?: string; italics?: boolean; size?: number } = {}) =>
  new Paragraph({
    spacing: { after: 120, line: 300 },
    children: [
      new TextRun({ text, color: opts.color ?? INK, italics: opts.italics, size: opts.size ?? 21 }),
    ],
  });

const Bullet = (text: string) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60, line: 280 },
    children: [new TextRun({ text, size: 21, color: INK })],
  });

const Link = (text: string, url: string) =>
  new Paragraph({
    spacing: { after: 60 },
    children: [
      new ExternalHyperlink({
        link: url,
        children: [new TextRun({ text, style: "Hyperlink", size: 20 })],
      }),
    ],
  });

/** Two-column table used for strengths/gaps and stack rows. */
function twoColTable(rows: [string, string][], headers?: [string, string]): Table {
  const cell = (text: string, opts: { bold?: boolean; fill?: string } = {}) =>
    new TableCell({
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      shading: opts.fill
        ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill }
        : undefined,
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: opts.bold, size: 20, color: INK })],
        }),
      ],
    });

  const body = rows.map(
    ([a, b]) => new TableRow({ children: [cell(a), cell(b)] }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: headers
      ? [
          new TableRow({
            tableHeader: true,
            children: [cell(headers[0], { bold: true, fill: HAIRLINE }), cell(headers[1], { bold: true, fill: HAIRLINE })],
          }),
          ...body,
        ]
      : body,
  });
}

/** Markdown → paragraphs. Handles the shapes the model actually produces. */
function markdownToParagraphs(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{3,}\s/.test(line)) out.push(H2(plain(line.replace(/^#+\s*/, ""))));
    else if (/^#{1,2}\s/.test(line)) out.push(H2(plain(line.replace(/^#+\s*/, ""))));
    else if (/^[-*+]\s/.test(line)) out.push(Bullet(plain(line.replace(/^[-*+]\s*/, ""))));
    else if (/^\d+\.\s/.test(line)) out.push(Bullet(plain(line.replace(/^\d+\.\s*/, ""))));
    else if (/^>\s?/.test(line)) out.push(P(plain(line.replace(/^>\s?/, "")), { italics: true, color: MUTED }));
    else out.push(P(plain(line)));
  }
  return out;
}

export async function buildDocxBuffer(input: DocInput): Promise<Buffer> {
  const date = new Date(input.createdAt ?? Date.now()).toLocaleDateString();
  const children: (Paragraph | Table)[] = [];

  // --- Cover ---------------------------------------------------------------
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: input.title, bold: true, size: 48, color: BRAND })],
    }),
    P(input.idea, { color: MUTED, size: 22 }),
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: `Generated by IdeaForge · ${date}`, italics: true, size: 18, color: MUTED }),
      ],
    }),
  );

  // --- Validation ----------------------------------------------------------
  if (input.validationMarkdown) {
    children.push(H1("1. Problem validation"));
    children.push(...markdownToParagraphs(input.validationMarkdown));
  }

  // --- Research ------------------------------------------------------------
  const r = input.research;
  if (r) {
    children.push(H1("2. Research"));
    if (r.summaryMarkdown) children.push(...markdownToParagraphs(r.summaryMarkdown));

    if (r.existingSolutions?.length) {
      children.push(H2("Existing solutions"));
      for (const s of r.existingSolutions) {
        children.push(
          new Paragraph({
            spacing: { before: 160, after: 60 },
            children: [new TextRun({ text: s.name, bold: true, size: 22, color: INK })],
          }),
        );
        if (s.what) children.push(P(plain(s.what), { color: MUTED, size: 20 }));
        const pairs: [string, string][] = [];
        const strengths = s.strengths ?? [];
        const gaps = s.gaps ?? [];
        for (let i = 0; i < Math.max(strengths.length, gaps.length); i++) {
          pairs.push([strengths[i] ?? "", gaps[i] ?? ""]);
        }
        if (pairs.length) children.push(twoColTable(pairs, ["Strengths", "Gaps"]));
      }
    }

    if (r.gaps?.length) {
      children.push(H2("Innovation gaps"));
      for (const g of r.gaps) {
        children.push(
          new Paragraph({
            spacing: { before: 140, after: 40 },
            children: [new TextRun({ text: g.title, bold: true, size: 21, color: INK })],
          }),
        );
        if (g.description) children.push(P(plain(g.description), { size: 20 }));
        if (g.opportunity) children.push(P(`Opportunity: ${plain(g.opportunity)}`, { color: BRAND, size: 20 }));
      }
    }

    if (r.citations?.length) {
      children.push(H2("Sources"));
      for (const c of r.citations) children.push(Link(`[${c.id}] ${c.title} — ${c.source}`, c.url));
    }

    // Resources live on the research report; older projects keep them on the plan.
    const res = r.resources ?? {
      papers: input.plan?.papers ?? [],
      repos: input.plan?.repos ?? [],
      datasets: input.plan?.datasets ?? [],
      videos: [],
    };
    const buckets: [string, { title: string; url: string }[]][] = [
      ["Research papers", res.papers ?? []],
      ["Repositories", res.repos ?? []],
      ["Datasets", res.datasets ?? []],
      ["Related videos", res.videos ?? []],
    ];
    if (buckets.some(([, items]) => items.length)) {
      children.push(H2("Resources"));
      for (const [label, items] of buckets) {
        if (!items.length) continue;
        children.push(
          new Paragraph({
            spacing: { before: 140, after: 60 },
            children: [new TextRun({ text: label, bold: true, size: 20, color: MUTED })],
          }),
        );
        for (const item of items) children.push(Link(item.title, item.url));
      }
    }
  }

  // --- Plan ----------------------------------------------------------------
  const plan = input.plan;
  if (plan) {
    children.push(H1("3. Build plan"));
    if (plan.pitch) children.push(P(plain(plan.pitch), { size: 22 }));

    if (plan.techStack?.length) {
      children.push(H2("Recommended tech stack"));
      children.push(
        twoColTable(
          plan.techStack.map((t) => [`${t.category}: ${t.choice}`, plain(t.why ?? "")]),
          ["Choice", "Why"],
        ),
      );
    }

    if (plan.architecture?.length) {
      children.push(H2("Architecture"));
      for (const a of plan.architecture) {
        children.push(Bullet(`${a.name} — ${plain(a.responsibility ?? "")}`));
      }
    }

    if (plan.milestones?.length) {
      children.push(H2("Milestones"));
      plan.milestones.forEach((m, i) => {
        children.push(
          new Paragraph({
            spacing: { before: 140, after: 40 },
            children: [
              new TextRun({ text: `${i + 1}. ${m.phase}`, bold: true, size: 21, color: INK }),
              ...(m.goal ? [new TextRun({ text: `  — ${plain(m.goal)}`, size: 19, color: MUTED })] : []),
            ],
          }),
        );
        for (const task of m.tasks ?? []) children.push(Bullet(plain(task)));
        if (m.deliverable) children.push(P(`Deliverable: ${plain(m.deliverable)}`, { color: BRAND, size: 19 }));
      });
    }

    if (plan.apis?.length) {
      children.push(H2("APIs and services"));
      children.push(
        twoColTable(
          plan.apis.map((a) => [a.name, plain(a.purpose ?? "")]),
          ["API", "Use for"],
        ),
      );
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: 400 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "Assembled automatically by IdeaForge. Verify sources before relying on them.",
          italics: true,
          size: 17,
          color: MUTED,
        }),
      ],
    }),
  );

  const doc = new Document({
    creator: "IdeaForge",
    title: input.title,
    description: input.idea,
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}
