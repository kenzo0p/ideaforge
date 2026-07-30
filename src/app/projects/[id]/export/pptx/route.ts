import { getProject } from "@/lib/db/projects";
import { getCurrentUser } from "@/lib/auth/session";
import { buildPptxBuffer } from "@/lib/export/deck";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /projects/[id]/export/pptx — download the project brief as a PowerPoint
// deck. Owner-scoped: a non-owner gets 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const project = await getProject(id, user.id);
  if (!project) return new Response("Not found", { status: 404 });

  const buffer = await buildPptxBuffer({
    title: project.title,
    idea: project.idea,
    validationMarkdown: project.validationMarkdown,
    research: project.research,
    plan: project.plan,
  });

  const slug =
    project.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "brief";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="ideaforge-${slug}.pptx"`,
      "Cache-Control": "no-store",
    },
  });
}
