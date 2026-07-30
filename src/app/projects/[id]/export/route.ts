import { getProject } from "@/lib/db/projects";
import { getCurrentUser } from "@/lib/auth/session";
import { buildMarkdownBrief } from "@/lib/export/brief";

export const runtime = "nodejs";

// GET /projects/[id]/export — download the project's full brief as Markdown.
// Owner-scoped: a non-owner gets 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const project = await getProject(id, user.id);
  if (!project) return new Response("Not found", { status: 404 });

  const md = buildMarkdownBrief({
    title: project.title,
    idea: project.idea,
    createdAt: project.createdAt,
    validationMarkdown: project.validationMarkdown,
    research: project.research,
    plan: project.plan,
  });

  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "brief";

  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="ideaforge-${slug}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
