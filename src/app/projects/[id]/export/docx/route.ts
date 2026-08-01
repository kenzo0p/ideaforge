import { getProject } from "@/lib/db/projects";
import { getCurrentUser } from "@/lib/auth/session";
import { buildDocxBuffer } from "@/lib/export/doc";
import { slugify } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /projects/[id]/export/docx — download the project brief as an editable
// Word document. Scoped to people with access, so a collaborator can grab it too.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const project = await getProject(id, user.id);
  if (!project) return new Response("Not found", { status: 404 });

  const buffer = await buildDocxBuffer({
    title: project.title,
    idea: project.idea,
    createdAt: project.createdAt,
    validationMarkdown: project.validationMarkdown,
    research: project.research,
    plan: project.plan,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="ideaforge-${slugify(project.title)}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
