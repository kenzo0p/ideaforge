import type { AIProvider, GenerateOptions } from "./types";

// ---------------------------------------------------------------------------
// Mock provider
//
// Synthesizes realistic, idea-aware output locally so the product runs with no
// API keys. Feature prompts embed a `[[TASK:<name>]]` tag in the system message;
// the mock dispatches on it. Swapping in a real provider changes nothing else.
// ---------------------------------------------------------------------------

export class MockProvider implements AIProvider {
  readonly id = "mock";
  readonly label = "Demo (offline)";
  readonly isMock = true;

  async *streamText(options: GenerateOptions): AsyncIterable<string> {
    const task = readTag(options.messages, "TASK") ?? "generic";
    const idea = lastUserMessage(options.messages);
    const text = render(task, idea);

    // Stream word-by-word so the UI behaves exactly like a real model.
    for (const token of tokenize(text)) {
      if (options.signal?.aborted) return;
      await delay(12);
      yield token;
    }
  }

  async generateText(options: GenerateOptions): Promise<string> {
    const task = readTag(options.messages, "TASK") ?? "generic";
    return render(task, lastUserMessage(options.messages));
  }
}

// --- helpers ---------------------------------------------------------------

function lastUserMessage(messages: GenerateOptions["messages"]): string {
  const user = [...messages].reverse().find((m) => m.role === "user");
  return (user?.content ?? "").trim();
}

function readTag(messages: GenerateOptions["messages"], key: string): string | null {
  const joined = messages.map((m) => m.content).join("\n");
  const match = joined.match(new RegExp(`\\[\\[${key}:([a-z-]+)\\]\\]`, "i"));
  return match ? match[1].toLowerCase() : null;
}

function tokenize(text: string): string[] {
  return text.match(/\s*\S+/g) ?? [text];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Pull a short, human-readable subject out of the raw idea text. */
function subjectOf(idea: string): string {
  const cleaned = idea
    .replace(/^(build|create|make|design|develop|an?\s)\s*/i, "")
    .replace(/[.\s]+$/, "")
    .trim();
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "…" : cleaned || "this idea";
}

function render(task: string, rawUser: string): string {
  switch (task) {
    case "problem-validation":
      return problemValidation(subjectOf(rawUser));
    case "deep-research": {
      // The user message is "IDEA: <idea>\n\nSOURCES: ...". Pull the idea out.
      const ideaLine = rawUser.match(/IDEA:\s*(.+)/i)?.[1] ?? rawUser;
      return deepResearch(subjectOf(ideaLine));
    }
    case "project-hub": {
      const ideaLine = rawUser.match(/IDEA:\s*(.+)/i)?.[1] ?? rawUser;
      return projectHub(subjectOf(ideaLine));
    }
    case "agent-reply":
      return agentReply(rawUser.trim());
    default:
      return `## Analysis\n\nHere is an analysis of **${subjectOf(rawUser)}**. (Demo provider — add an \`OPENAI_API_KEY\` or \`ANTHROPIC_API_KEY\` to \`.env.local\` for live model output.)`;
  }
}

/** Demo DeepSearch briefing as strict JSON, referencing the mock sources [1]–[5]. */
function deepResearch(subject: string): string {
  const payload = {
    summaryMarkdown:
      `Research on **${subject}** shows an active and maturing space. Academic surveys map several competing approaches with different accuracy, cost, and deployment trade-offs [1], while open-source projects provide reference architectures teams can build on [2]. ` +
      `On the market side, a growing set of startups is commercializing early solutions, though products still leave clear gaps for end users [3]. Demand indicators — adoption trends and market sizing — suggest the underlying problem is real and growing [4]. ` +
      `Practitioner guides converge on a handful of proven architectures while warning about common pitfalls in data quality and adoption [5]. The opportunity lies in combining these threads into something faster, more trustworthy, and easier to adopt than what exists today.`,
    existingSolutions: [
      {
        name: "Established incumbents",
        what: `Broad tools that touch ${subject} as one feature among many.`,
        strengths: ["Trusted brand", "Wide integrations"],
        gaps: ["Generic, not purpose-built", "Slow to adapt"],
        citations: [3],
      },
      {
        name: "Open-source project",
        what: `Community reference implementation for ${subject}.`,
        strengths: ["Free and extensible", "Transparent"],
        gaps: ["Requires setup expertise", "No managed experience"],
        citations: [2],
      },
      {
        name: "Early-stage startups",
        what: `Focused products tackling a slice of ${subject}.`,
        strengths: ["Modern UX", "Fast-moving"],
        gaps: ["Narrow coverage", "Unproven at scale"],
        citations: [3, 4],
      },
    ],
    gaps: [
      {
        title: "Trust & verifiability",
        description: "Existing options rarely show *why* to trust their output.",
        opportunity: "Ground every recommendation in cited, checkable evidence.",
      },
      {
        title: "Adoption friction",
        description: "Powerful tools that demand expertise stall on adoption.",
        opportunity: "Deliver an opinionated, zero-setup experience for the core loop.",
      },
      {
        title: "Fragmented workflow",
        description: "Users stitch together many tools to go from idea to build.",
        opportunity: "Unify discovery → research → planning in one guided flow.",
      },
    ],
  };
  return JSON.stringify(payload);
}

/** Demo agent reply — a short, practical chat message about the question. */
function agentReply(question: string): string {
  const q = question.slice(0, 120);
  return `Good question — "${q}". Based on this project's validation, research, and plan, I'd focus on the single riskiest assumption first: prove people will actually use it before building everything. Start with the first milestone, keep your sources and decisions in the workspace, and revisit the plan as you learn.\n\n_(Demo agent — add an AI key for fully context-aware answers.)_`;
}

/** Demo Project HUB plan as strict JSON. Resources are attached server-side. */
function projectHub(subject: string): string {
  const name = capitalize(subject.split(/\s+/).slice(0, 2).join(" ")) || "IdeaForge";
  const payload = {
    title: `${name} Copilot`,
    pitch: `A focused tool that helps people with ${subject} — faster, cheaper, and more trustworthy than today's options.`,
    techStack: [
      { category: "Frontend", choice: "Next.js + Tailwind CSS", why: "Fast to build, great DX, SSR out of the box." },
      { category: "Backend", choice: "Next.js API routes (Node)", why: "One codebase, easy streaming endpoints." },
      { category: "AI/ML", choice: "OpenAI / Anthropic via a provider layer", why: "Swappable models behind one interface." },
      { category: "Data", choice: "PostgreSQL + Prisma", why: "Reliable relational store with typed access." },
      { category: "Infra", choice: "Vercel + managed Postgres", why: "Zero-ops deploys and previews." },
    ],
    architecture: [
      { name: "Web App", responsibility: "UI for input and results.", connectsTo: ["API Gateway"] },
      { name: "API Gateway", responsibility: "Validates requests, orchestrates services.", connectsTo: ["AI Service", "Search Service", "Database"] },
      { name: "AI Service", responsibility: "Prompts and structures model output.", connectsTo: ["Database"] },
      { name: "Search Service", responsibility: "Grounds results in live web data.", connectsTo: [] },
      { name: "Database", responsibility: "Persists projects and findings.", connectsTo: [] },
    ],
    milestones: [
      { phase: "Week 1 · Foundation", goal: "Stand up the core loop.", tasks: ["Scaffold app", "Wire provider layer", "Ship input → result"], deliverable: "Working vertical slice" },
      { phase: "Week 2 · Intelligence", goal: "Add grounded research.", tasks: ["Integrate search", "Citations", "Comparison view"], deliverable: "Citation-backed briefings" },
      { phase: "Week 3 · Planning", goal: "Generate build plans.", tasks: ["Plan generation", "Resource recommendations", "Export"], deliverable: "End-to-end plan output" },
      { phase: "Week 4 · Polish", goal: "Harden and present.", tasks: ["Auth + persistence", "Dashboard", "Demo script"], deliverable: "Demo-ready product" },
    ],
    apis: [
      { name: "OpenAI / Anthropic API", purpose: "LLM reasoning and synthesis." },
      { name: "Tavily Search API", purpose: "Real-time web results for grounding." },
      { name: "GitHub REST API", purpose: "Discover relevant repositories." },
    ],
    clusters: [
      { theme: "Technical approaches", summary: "How comparable systems are built.", items: ["Reference architectures", "Model + retrieval patterns", "Deployment trade-offs"] },
      { theme: "Market & users", summary: "Who needs this and why now.", items: ["Primary user segment", "Adoption drivers", "Willingness to switch"] },
      { theme: "Risks & constraints", summary: "What could derail the build.", items: ["Data quality", "Privacy/compliance", "Adoption friction"] },
    ],
  };
  return JSON.stringify(payload);
}

function problemValidation(subject: string): string {
  return `## Problem Validation

**Restated problem** — Your idea centers on **${subject}**. Framed as a job-to-be-done: *"Help the people affected by this problem reach a better outcome with less effort, cost, or risk than they can today."*

**Is this a real problem worth solving?** &nbsp; ✅ Likely yes — it maps to a recurring, felt pain rather than a one-off annoyance.

**Severity:** 7 / 10 — meaningful pain, several existing workarounds, room for a materially better solution.

### Who is affected
- **Primary:** the users living the problem day-to-day.
- **Secondary:** the institutions, teams, or communities around them who absorb the downstream cost.
- **Economic buyer:** whoever pays for or approves a solution (often *not* the primary user).

### Why it matters now
The problem is getting more acute because of scale, cost pressure, and rising expectations. Ignoring it compounds waste, frustration, and missed opportunity over time.

### Evidence to look for (validate before building)
- Are people already hacking together spreadsheets, group chats, or manual processes to cope?
- Is there search demand, forum activity, or paid tools in the space?
- Would a user switch from their current workaround for a 2× better option?

### Key risks & assumptions
- ⚠️ The problem may be *painful but low-priority* for the buyer.
- ⚠️ Behaviour change is hard — adoption, not technology, is usually the bottleneck.
- ⚠️ Regulatory, privacy, or data-access constraints may apply.

### Refined problem statement
> For **[specific user segment]**, who struggle with **${subject}**, existing options are **too slow / manual / expensive / unreliable**. We will deliver **[core solution]** that makes it **measurably faster and more trustworthy**, unlike **[current alternative]**.

### Suggested v1 scope
Start narrow: solve the single sharpest pain for one clearly-defined user group, prove they'll use it weekly, *then* expand. Resist building the full platform before the core loop is validated.`;
}
