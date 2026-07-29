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
}

const HELP = `🤖 *IdeaForge Agent*
I help you move projects forward. Try:
• /projects — list your saved projects
• /status — where a project stands
• /next — the recommended next step
• /plan — summarize the build plan
• or just ask me anything about the project.`;

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

  if (cmd === "/projects" || cmd === "projects" || cmd.startsWith("list")) {
    const projects = listProjects(input.userId);
    if (projects.length === 0) return "You have no saved projects yet. Create one in IdeaForge first.";
    return (
      "📁 *Your projects:*\n" +
      projects.slice(0, 10).map((p, i) => `${i + 1}. ${p.title}`).join("\n")
    );
  }

  const project = input.projectId ? getProject(input.projectId, input.userId) : null;

  if (!project) {
    if (cmd.startsWith("/")) return "Open a project first, then I can answer /status, /next, and /plan for it.";
    // General question without a project scope.
    return "Pick a project (open it in IdeaForge) and I'll answer questions grounded in its research and plan. Meanwhile, send /projects to see what you've saved.";
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
