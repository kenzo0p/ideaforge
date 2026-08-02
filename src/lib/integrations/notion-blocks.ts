// ---------------------------------------------------------------------------
// Markdown → Notion blocks.
//
// Kept free of imports so it can be unit-tested without pulling in Next's
// request context (the OAuth half of the Notion module needs `next/headers`).
// ---------------------------------------------------------------------------

/** Notion caps `children` at 100 blocks per request. */
export const MAX_BLOCKS_PER_REQUEST = 100;
/** And rich_text content at 2000 characters per item. */
const MAX_TEXT = 2000;

export type RichText = { type: "text"; text: { content: string; link?: { url: string } } };
export type Block = Record<string, unknown>;


/** Split inline markdown into Notion rich_text, preserving links. */
function richText(md: string): RichText[] {
  const out: RichText[] = [];
  // Only links need structure; bold/italic are stripped rather than faked,
  // because a wrong annotation is more distracting than plain text.
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const m of md.matchAll(linkRe)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text(md.slice(last, at)));
    out.push({ type: "text", text: { content: clean(m[1]), link: { url: m[2] } } });
    last = at + m[0].length;
  }
  if (last < md.length) out.push(text(md.slice(last)));
  return out.filter((t) => t.text.content.length > 0).slice(0, 100);
}

const clean = (s: string) =>
  s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .slice(0, MAX_TEXT);

const text = (content: string): RichText => ({ type: "text", text: { content: clean(content) } });

const block = (type: string, content: string, extra: Block = {}): Block => ({
  object: "block",
  type,
  [type]: { rich_text: richText(content), ...extra },
});

/**
 * Convert a markdown brief into Notion blocks.
 *
 * Deliberately handles only what the brief actually contains — headings, lists,
 * quotes, dividers, code fences and paragraphs. A general markdown parser would
 * be more code and no more correct for this input.
 */
export function markdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let inCode = false;
  let codeBuffer: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push({
          object: "block",
          type: "code",
          code: { rich_text: [text(codeBuffer.join("\n"))], language: "plain text" },
        });
        codeBuffer = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }

    if (!line.trim()) continue;
    if (/^---+$/.test(line.trim())) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(block(`heading_${level}` as const, heading[2]));
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      blocks.push(block("bulleted_list_item", bullet[1]));
      continue;
    }
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numbered) {
      blocks.push(block("numbered_list_item", numbered[1]));
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(block("quote", quote[1]));
      continue;
    }
    // Markdown tables have no clean block equivalent; keep the row as text
    // rather than dropping the content entirely.
    blocks.push(block("paragraph", line));
  }

  return blocks;
}
