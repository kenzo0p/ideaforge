import type { ChatMessage } from "@/lib/ai";
import type { SearchResult } from "@/lib/search";
import type { IdeaInput, ResearchReport } from "./types";

// Prompt builders for each Layer 2 capability. The `[[TASK:<name>]]` tag lets the
// Mock provider synthesize the right kind of output; real models simply ignore it.

export function problemValidationMessages({ idea, locale = "en" }: IdeaInput): ChatMessage[] {
  return [
    {
      role: "system",
      content: `[[TASK:problem-validation]]
You are iNSIGHTS, an AI research & innovation copilot for students and builders.
Given a raw project idea, produce a rigorous PROBLEM VALIDATION.

Return Markdown with these sections, in this order:
1. **Restated problem** — reframe the idea as a clear job-to-be-done.
2. A one-line verdict on whether it's a real problem worth solving.
3. **Severity** — an X/10 score with a short justification.
4. **Who is affected** — primary, secondary, and the economic buyer.
5. **Why it matters now** — the trend making it urgent.
6. **Evidence to look for** — concrete signals to validate demand before building.
7. **Key risks & assumptions** — the ways this could be a bad bet.
8. **Refined problem statement** — a crisp, testable one-sentence statement.
9. **Suggested v1 scope** — the narrowest slice worth building first.

Be specific and honest — flag weak ideas. Do not invent statistics or fake
citations (real research comes in a later step). Respond in locale "${locale}".`,
    },
    { role: "user", content: idea },
  ];
}

/** Strip filler verbs / trailing punctuation to get a compact search topic. */
export function deriveTopic(idea: string): string {
  return idea
    .replace(/^(build|create|make|design|develop)\s+(an?\s+)?/i, "")
    .replace(/[.?!]+$/, "")
    .trim()
    .slice(0, 90);
}

/** Derive a small set of focused search queries from a raw idea (no LLM call). */
export function deepResearchQueries(idea: string): string[] {
  const topic = deriveTopic(idea);
  return [
    topic,
    `${topic} existing solutions and competitors`,
    `${topic} research and academic papers`,
    `${topic} statistics and market`,
  ];
}

/**
 * Synthesis prompt for DeepSearch. The model receives numbered, real search
 * results and must ground every claim in them via [n] markers. We build the
 * citation list from the results themselves, so URLs are never hallucinated.
 */
export function deepResearchMessages(
  idea: string,
  results: SearchResult[],
  locale = "en",
): ChatMessage[] {
  const context = results
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.source}\n${r.content}`)
    .join("\n\n");

  return [
    {
      role: "system",
      content: `[[TASK:deep-research]]
You are iNSIGHTS DeepSearch. Using ONLY the numbered SOURCES provided, produce a
grounded research briefing for the user's idea. Cite claims with [n] markers that
refer to the sources. Never invent sources, URLs, or statistics not present.

Return a STRICT JSON object (no markdown fences) with this shape:
{
  "summaryMarkdown": "3–5 short paragraphs of markdown with [n] citation markers covering the state of the art, what's known, and market/literature context",
  "existingSolutions": [
    { "name": "...", "what": "one line", "strengths": ["..."], "gaps": ["where it falls short"], "citations": [1] }
  ],
  "gaps": [
    { "title": "short label", "description": "the unmet need", "opportunity": "the innovative angle to pursue" }
  ]
}
Provide 2–4 existingSolutions and 2–4 gaps. Respond in locale "${locale}".`,
    },
    {
      role: "user",
      content: `IDEA: ${idea}\n\nSOURCES:\n${context}`,
    },
  ];
}

/** Agent reply prompt — answers a user's question grounded in project context. */
export function agentReplyMessages(
  question: string,
  projectTitle: string,
  context: string,
  locale = "en",
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `[[TASK:agent-reply]]
You are the IdeaForge AI Agent, chatting with a student building the project
"${projectTitle}". Answer their question using the PROJECT CONTEXT below. Be
concise and practical — this is a chat message, so keep it short (a few sentences
or a tight list). If the context doesn't cover it, say so and suggest a next step.
Respond in locale "${locale}".

PROJECT CONTEXT:
${context}`,
    },
    { role: "user", content: question },
  ];
}

/** Searches used to ground repo / dataset / paper recommendations. */
export function resourceQueries(idea: string): string[] {
  const topic = deriveTopic(idea);
  return [
    `${topic} open source github project`,
    `${topic} dataset kaggle huggingface`,
    `${topic} research paper arxiv`,
  ];
}

/**
 * Project HUB prompt. The model designs the plan (stack, architecture,
 * milestones, APIs, clusters). Repos/datasets/papers are attached separately
 * from real search results, so their URLs are never hallucinated.
 */
export function projectHubMessages(
  idea: string,
  research: ResearchReport | null,
  resourceTitles: string[],
  locale = "en",
): ChatMessage[] {
  const researchContext = research
    ? `\n\nRESEARCH CONTEXT:\nExisting solutions: ${research.existingSolutions
        .map((s) => s.name)
        .join(", ")}\nGaps/opportunities: ${research.gaps
        .map((g) => `${g.title} — ${g.opportunity}`)
        .join("; ")}`
    : "";
  const resourceContext = resourceTitles.length
    ? `\n\nDISCOVERED RESOURCES (for your awareness):\n- ${resourceTitles.join("\n- ")}`
    : "";

  return [
    {
      role: "system",
      content: `[[TASK:project-hub]]
You are iNSIGHTS Project HUB. Turn the idea into a concrete, buildable project
plan a student team could execute. Be specific and realistic; prefer widely-used,
free/low-cost tools. Use the research context to lean into the identified gaps.

Return a STRICT JSON object (no markdown fences) with this shape:
{
  "title": "a memorable project name",
  "pitch": "one-sentence pitch",
  "techStack": [ { "category": "Frontend|Backend|AI/ML|Data|Infra|...", "choice": "tool", "why": "one line" } ],
  "architecture": [ { "name": "component", "responsibility": "one line", "connectsTo": ["other component names"] } ],
  "milestones": [ { "phase": "Week 1–2 · Foundation", "goal": "one line", "tasks": ["..."], "deliverable": "what ships" } ],
  "apis": [ { "name": "API/service", "purpose": "one line", "url": "optional" } ],
  "clusters": [ { "theme": "short theme", "summary": "one line", "items": ["key point", "key point"] } ]
}
Provide 4–6 techStack items, 3–5 architecture components, 3–4 milestones,
2–4 apis, and 3–4 knowledge clusters. Respond in locale "${locale}".`,
    },
    {
      role: "user",
      content: `IDEA: ${idea}${researchContext}${resourceContext}`,
    },
  ];
}
