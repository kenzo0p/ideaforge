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

// Filler words to drop when extracting domain keywords for resource APIs
// (GitHub/Kaggle/CORE), which return far better results for short noun queries.
const KEYWORD_STOP = new Set([
  "build", "create", "make", "design", "develop", "use", "using", "used",
  "a", "an", "the", "to", "in", "of", "for", "and", "or", "with", "that",
  "into", "from", "on", "your", "my", "it", "via", "app", "application",
  "tool", "solution", "system", "platform", "ai", "ml", "based", "detect",
  "detects", "reduce", "reduces", "turns", "turn", "help", "helps", "smart",
]);

/**
 * Extract domain keywords from an idea for resource search. Drops filler/tech
 * verbs so what remains is the salient noun phrase, e.g.
 * "Build an AI solution to reduce food waste in college hostels" →
 * "food waste college hostels".
 */
export function keywordsFor(idea: string): string {
  const words = idea
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !KEYWORD_STOP.has(w));
  return words.slice(0, 5).join(" ") || deriveTopic(idea);
}

/**
 * Compact search topic: drop the leading filler verb, then keep the head of the
 * sentence up to the first clause break.
 *
 * Two things matter here. Search engines do badly on long natural-language
 * sentences, and a hard `.slice(90)` used to cut mid-word — every query for a
 * long idea ended in a fragment like "…data with sho", which drags the whole
 * result set off-topic. Cut on a word boundary, and prefer a clause boundary.
 */
export function deriveTopic(idea: string): string {
  const MAX_WORDS = 12;
  const stripped = idea
    .replace(/^(?:build|create|make|design|develop)\s+(?:an?\s+)?/i, "")
    .replace(/[.?!]+$/, "")
    .trim();

  const words = stripped.split(/\s+/).filter(Boolean);
  // Already compact — every word is signal, so keep the lot. Trimming here is
  // what turned "campus tool that matches students to research labs" into the
  // uselessly generic "campus tool".
  if (words.length <= MAX_WORDS) return stripped;

  // Only for genuinely long ideas: a clause break ("… that fuses X with Y") is
  // usually where the distinctive part ends and the elaboration begins. Ignore
  // the split when the head is too short to stand on its own.
  const head = stripped.split(/\s+(?:that|which|so\s+that|in\s+order\s+to)\s+/i)[0] ?? "";
  const headWords = head.split(/\s+/).filter(Boolean);
  // Three words is enough to be specific ("hyperlocal hydroclimate-whiplash
  // alert tool"); fewer than that and the head is too generic to search on.
  const chosen = headWords.length >= 3 ? headWords : words;

  return chosen.slice(0, MAX_WORDS).join(" ").replace(/[,;:–—-]+$/, "").trim();
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
  "summaryMarkdown": "2–3 SHORT paragraphs (≤90 words each) of markdown with [n] citation markers covering the state of the art, what's known, and market/literature context — be concise",
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

/**
 * Deck/document review. The model sees the extracted text of the user's own
 * pitch deck or write-up and returns concrete, actionable improvements.
 */
export function documentReviewMessages(
  fileName: string,
  kind: "pptx" | "pdf",
  sectionCount: number,
  text: string,
  locale = "en",
): ChatMessage[] {
  const unit = kind === "pptx" ? "slide" : "page";
  return [
    {
      role: "system",
      content: `[[TASK:document-review]]
You are iNSIGHTS reviewing a student's ${kind === "pptx" ? "pitch deck" : "project document"}
("${fileName}", ${sectionCount} ${unit}s). Give the honest, specific feedback a
demanding but supportive judge would give. Prefer concrete rewrites over vague
advice ("replace 'we help students' with the specific job-to-be-done" beats
"be clearer"). Judge the CONTENT — ignore that formatting/visuals aren't visible
in extracted text, and never criticise missing images or design.

Return a STRICT JSON object (no markdown fences):
{
  "score": 0-100,
  "verdict": "one honest sentence on how close this is to presentation-ready",
  "strengths": [{ "title": "short label", "detail": "what works and why" }],
  "improvements": [{ "title": "short label", "detail": "the specific change to make" }],
  "missing": ["a section or claim a judge will expect but can't find"],
  "sectionNotes": [{ "index": 1, "issue": "what's weak on this ${unit}", "fix": "the concrete fix" }]
}
Provide 2–4 strengths, 3–6 improvements, 2–5 missing items, and notes for the
3–6 weakest ${unit}s only. Respond in locale "${locale}".`,
    },
    { role: "user", content: `DOCUMENT TEXT:\n${text}` },
  ];
}

/** Searches used to ground problem discovery in current, real-world signals. */
export function problemDiscoveryQueries(domain: string): string[] {
  const d = domain.trim() || "students and everyday life";
  return [
    `biggest unsolved problems and pain points in ${d} 2025`,
    `emerging challenges and unmet needs in ${d}`,
    `${d} frustrations people complain about`,
  ];
}

/**
 * Problem-discovery synthesis. Grounds a set of concrete, worth-solving problems
 * in the numbered SOURCES, each with a starter idea that feeds validation.
 */
export function problemDiscoveryMessages(
  domain: string,
  results: SearchResult[],
  locale = "en",
): ChatMessage[] {
  const context = results
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.source}\n${r.content}`)
    .join("\n\n");
  const scope = domain.trim() || "students and everyday life";

  return [
    {
      role: "system",
      content: `[[TASK:problem-discovery]]
You are iNSIGHTS Problem Discovery. Using the numbered SOURCES as evidence,
surface concrete, real-world problems worth solving in the area of "${scope}".
Favor specific, felt pains over vague themes. Ground claims in [n] markers where
the sources support them; never invent statistics.

Return a STRICT JSON object (no markdown fences) with this shape:
{
  "problems": [
    {
      "title": "the problem in one sharp line",
      "description": "1–2 sentences on the problem",
      "whoIsAffected": "who feels this pain",
      "whyNow": "the trend making it urgent",
      "signals": ["evidence it's real (from sources)"],
      "starterIdea": "a concrete one-line project idea to solve it",
      "citations": [1]
    }
  ]
}
Provide 4–6 distinct problems. Respond in locale "${locale}".`,
    },
    { role: "user", content: `DOMAIN: ${scope}\n\nSOURCES:\n${context}` },
  ];
}

/** One search per candidate idea — enough to ground the comparison, cheap enough to stay fast. */
export function compareQueries(ideas: string[]): string[] {
  return ideas.map((idea) => `${deriveTopic(idea)} existing solutions`);
}

/**
 * Idea comparison prompt.
 *
 * All candidates go in a single call on purpose. Scoring them independently and
 * sorting afterwards produces uncalibrated numbers — every idea comes back a 7.
 * Judging them against each other forces real separation.
 *
 * The model scores; it does not rank. The weighted total and the ordering are
 * computed in code so the verdict can never contradict the numbers on screen.
 */
export function compareIdeasMessages(
  ideas: string[],
  results: SearchResult[],
  locale = "en",
): ChatMessage[] {
  const context = results
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.source}\n${r.content}`)
    .join("\n\n");
  const list = ideas.map((idea, i) => `IDEA ${i + 1}: ${idea}`).join("\n");

  return [
    {
      role: "system",
      content: `[[TASK:idea-comparison]]
You are iNSIGHTS Idea Comparison. You are given ${ideas.length} candidate ideas
and numbered SOURCES. Judge the ideas AGAINST EACH OTHER and score each on four
axes from 1 to 10.

Scoring rules — follow these or the comparison is useless:
- Score relatively. Spread the numbers out. If two ideas differ, their scores
  must differ. Do not give everything 6–8.
- Use the full range. A weak idea should score 2–3, not 5.
- severity: how badly the problem hurts the people who have it.
- reach: how many people genuinely have this problem.
- feasibility: how realistically a small team ships a working version fast.
- differentiation: how much room is left once existing solutions are counted.
  If the sources show this is a crowded space, this score must be low.
- Be willing to say an idea is weak. A comparison where everything wins is
  worthless to the person choosing.

Cite [n] markers where a source informs a judgement. Never invent statistics.

Return a STRICT JSON object (no markdown fences) with this shape:
{
  "ideas": [
    {
      "index": 1,
      "title": "3–5 word label for this idea",
      "scores": { "severity": 7, "reach": 5, "feasibility": 8, "differentiation": 4 },
      "verdict": "one sentence on whether this is worth building",
      "strengths": ["what genuinely works about it"],
      "risks": ["the thing most likely to kill it"],
      "citations": [1]
    }
  ],
  "rationale": "2–3 sentences on why the strongest idea beats the others SPECIFICALLY — name the trade-off you made"
}
Include every idea, with "index" matching its number above. Respond in locale "${locale}".`,
    },
    { role: "user", content: `${list}\n\nSOURCES:\n${context}` },
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
