// The single source of truth for "what should this project do next", shared by
// the agent (/next, /status) and the reminder scheduler.

export interface ProjectProgress {
  validationMarkdown: string | null;
  research: unknown | null;
  plan: unknown | null;
}

export function projectNextStep(p: ProjectProgress): string {
  if (!p.validationMarkdown) return "validate the idea";
  if (!p.research) return "run DeepSearch for citation-backed research";
  if (!p.plan) return "generate the project plan in Project HUB";
  return "start building — pick the first milestone and log decisions in the workspace";
}
