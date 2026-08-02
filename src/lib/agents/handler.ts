import { getProvider } from "@/lib/ai";
import { getProject, listProjects, type Project } from "@/lib/db/projects";
import { agentReplyMessages } from "@/lib/insights/prompts";
import { projectNextStep } from "@/lib/insights/next-step";

// ---------------------------------------------------------------------------
// AI Agent — channel-agnostic message handler
//
// One brain for every channel. The in-app Agent Console and the Telegram
// webhook both call handleAgentMessage(); only the transport differs. Commands
// are handled locally; free-text questions are answered by the LLM, grounded in
// the referenced project's saved artifacts.
// ---------------------------------------------------------------------------

export interface AgentInput {
  text: string;
  /** The authenticated user; project data is scoped to them. */
  userId?: string | null;
  /** Project the conversation is scoped to (from the console, or a Telegram session). */
  projectId?: string | null;
  channel?: "console" | "telegram";
  locale?: string;
  /** Chat channels call this to remember the project the user picked. */
  onSelectProject?: (projectId: string) => void;
  /**
   * Buttons the handler wants attached to its reply. Set by the handler, read
   * by the transport — an out-parameter so the return type stays a plain string
   * for the in-app console, which has no concept of buttons.
   */
  buttons?: { text: string; data: string }[][];
}

const HELP = `🤖 *IdeaForge Agent*
I help you move projects forward. Try:
• /projects — list your projects, then tap one to pick it
• /status — where the current project stands
• /next — the recommended next step
• /plan — summarize the build plan
• or just ask me anything about the current project.`;

const ACTION_BUTTONS = [
  [
    { text: "📊 Status", data: "/status" },
    { text: "➡️ Next step", data: "/next" },
  ],
  [
    { text: "🗂 Plan", data: "/plan" },
    { text: "📁 Switch project", data: "/projects" },
  ],
];

export async function handleAgentMessage(input: AgentInput): Promise<string> {
  const text = input.text.trim();
  if (!text) return HELP;
  const cmd = text.toLowerCase();

  if (cmd === "/help" || cmd === "help") return HELP;

  // Project data requires an authenticated user (the console passes userId).
  if (!input.userId) {
    return input.channel === "telegram"
      ? "🔒 Connect your account first: open IdeaForge → *Connect Telegram* and tap the link, then come back."
      : "🔒 Connect your IdeaForge account to ask about your projects. Sign in at the app to continue.";
  }

  const projects = (await listProjects(input.userId)).slice(0, 10);

  if (cmd === "/projects" || cmd === "projects" || cmd.startsWith("list")) {
    if (projects.length === 0) return "You have no saved projects yet. Create one in IdeaForge first.";
    const current = input.projectId;
    const lines = projects
      .map((p) => `• ${p.id === current ? "*" + p.title + "* ← current" : p.title}`)
      .join("\n");
    // One button per project — nothing to type, nothing to mistype.
    input.buttons = projects.map((p) => [
      { text: `${p.id === current ? "✓ " : ""}${p.title.slice(0, 40)}`, data: `use:${p.id}` },
    ]);
    return `📁 *Your projects:*\n${lines}\n\nTap one to work on it.`;
  }

  // Select a project. `use:<id>` comes from a button tap; the numeric forms are
  // kept so anyone mid-conversation with the old flow isn't stranded.
  const byId = cmd.match(/^use:(\S+)$/);
  const byIndex = cmd.match(/^(?:\/use\s+)?(\d{1,2})$/);
  if ((byId || byIndex) && input.onSelectProject) {
    const chosen = byId
      ? projects.find((p) => p.id === byId[1])
      : projects[Number(byIndex![1]) - 1];
    if (!chosen) {
      return `I can't find that project. Send /projects to see your ${projects.length} project${projects.length === 1 ? "" : "s"}.`;
    }
    input.onSelectProject(chosen.id);
    const full = await getProject(chosen.id, input.userId);
    if (full) {
      input.buttons = ACTION_BUTTONS;
      return `✅ Now working on *${full.title}*.\n\n${statusReply(full)}`;
    }
    return `✅ Now working on *${chosen.title}*.`;
  }

  const project = input.projectId ? await getProject(input.projectId, input.userId) : null;

  if (!project) {
    const hint =
      projects.length > 0
        ? "Send /projects and tap one to pick it."
        : "You have no saved projects yet — create one in IdeaForge first.";
    return cmd.startsWith("/")
      ? `No project selected. ${hint}`
      : `I answer questions about one project at a time. ${hint}`;
  }

  if (cmd === "/status" || cmd === "status") return statusReply(project);
  if (cmd === "/next" || cmd === "next")
    return `➡️ Next step for *${project.title}*: ${projectNextStep(project)}`;
  if (cmd === "/plan" || cmd === "plan") return planReply(project);

  // Free-text question → grounded LLM answer.
  const context = buildContext(project);
  const reply = await getProvider().generateText({
    messages: agentReplyMessages(text, project.title, context, input.locale),
    temperature: 0.4,
    maxTokens: 600,
  });
  return reply.trim() || "I couldn't come up with a good answer — try rephrasing?";
}

function statusReply(p: Project): string {
  const done = [
    p.validationMarkdown ? "✅ Validation" : "⬜ Validation",
    p.research ? "✅ Research" : "⬜ Research",
    p.plan ? "✅ Plan" : "⬜ Plan",
  ].join("\n");
  return `📊 *${p.title}*\n${done}\n\n➡️ Next: ${projectNextStep(p)}`;
}

function planReply(p: Project): string {
  if (!p.plan) return `No plan yet for *${p.title}*. Generate one in Project HUB.`;
  const milestones = p.plan.milestones.map((m) => `• ${m.phase} — ${m.goal}`).join("\n");
  const stack = p.plan.techStack.map((t) => t.choice).slice(0, 4).join(", ");
  return `🚀 *${p.plan.title}*\n${p.plan.pitch}\n\n*Stack:* ${stack}\n\n*Roadmap:*\n${milestones}`;
}

/** Compact, model-friendly summary of everything known about a project. */
function buildContext(p: Project): string {
  const parts: string[] = [`IDEA: ${p.idea}`];
  if (p.validationMarkdown) parts.push(`VALIDATION:\n${p.validationMarkdown.slice(0, 1200)}`);
  if (p.research) {
    parts.push(`RESEARCH SUMMARY:\n${p.research.summaryMarkdown.slice(0, 1000)}`);
    if (p.research.gaps.length)
      parts.push(`GAPS: ${p.research.gaps.map((g) => g.title).join(", ")}`);
  }
  if (p.plan) {
    parts.push(
      `PLAN: ${p.plan.title} — ${p.plan.pitch}\nStack: ${p.plan.techStack
        .map((t) => t.choice)
        .join(", ")}\nMilestones: ${p.plan.milestones.map((m) => m.phase).join("; ")}`,
    );
  }
  return parts.join("\n\n");
}
