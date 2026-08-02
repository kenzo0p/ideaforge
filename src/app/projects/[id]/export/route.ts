import { getProject } from "@/lib/db/projects";
import { getCurrentUser } from "@/lib/auth/session";
import { buildMarkdownBrief } from "@/lib/export/brief";
import { slugify } from "@/lib/format";

export const runtime = "nodejs";

// GET /projects/[id]/export — the project's full brief as Markdown.
//
//   ?inline=1  serve as text/plain so the client can read it and copy it to the
//              clipboard, which is how it gets pasted straight into Notion.
//              Without it, the file downloads.
//
// Scoped by getProject, so collaborators can export too.
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

  const inline = new URL(_req.url).searchParams.get("inline") === "1";

  return new Response(md, {
    headers: {
      "Content-Type": inline ? "text/plain; charset=utf-8" : "text/markdown; charset=utf-8",
      ...(inline
        ? {}
        : {
            "Content-Disposition": `attachment; filename="ideaforge-${slugify(project.title)}.md"`,
          }),
      "Cache-Control": "no-store",
    },
  });
}
