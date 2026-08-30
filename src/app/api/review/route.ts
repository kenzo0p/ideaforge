import { classifyFailure } from "@/lib/health/failures";
import { track } from "@/lib/db/analytics";
import { EVENTS } from "@/lib/analytics/events";
import { getProvider } from "@/lib/ai";
import { getPipeline } from "@/lib/pipeline";
import { detectKind, extractDocument } from "@/lib/extract/document";
import { enforceRateLimit, requireApiUser } from "@/lib/auth/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

// POST /api/review — multipart upload of a .pptx or .pdf; returns a structured
// critique of the document's content with concrete improvements.
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const limited = await enforceRateLimit(auth.id, "copilot");
  if (limited) return limited;

  void track(EVENTS.DECK_REVIEWED, { userId: auth.id });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file received." }, { status: 400 });
  }
  if (file.size === 0) return Response.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File is too large (max 15 MB)." }, { status: 400 });
  }

  const kind = detectKind(file.name, file.type);
  if (!kind) {
    return Response.json(
      { error: "Unsupported file type — upload a .pptx or .pdf." },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const doc = await extractDocument(buffer, kind);

    if (doc.text.replace(/---[^\n]*---/g, "").trim().length < 80) {
      return Response.json(
        {
          error:
            "Couldn't read enough text from that file. If it's a scanned PDF or image-only deck, upload a text-based version.",
        },
        { status: 422 },
      );
    }

    const review = await getPipeline().reviewDocument(
      {
        fileName: file.name,
        kind,
        sectionCount: doc.sectionCount,
        text: doc.text,
        truncated: doc.truncated,
        locale: String(form.get("locale") ?? "en"),
      },
      req.signal,
    );

    return Response.json(review, {
      headers: { "Cache-Control": "no-store", "X-Provider": getProvider().label },
    });
  } catch (err) {
    // The upstream message is for the log, never for the browser: it carries
    // the vendor's name, our account state and their request id.
    const { userMessage, detail, kind, selfHealing } = classifyFailure(err);
    console.error(`review failed (${kind}):`, detail.slice(0, 300));
    return Response.json(
      { error: userMessage, retryable: selfHealing },
      // 503 when the dependency is down rather than 500: it says "come back",
      // and it keeps genuine bugs on our side distinguishable in the logs.
      { status: kind === "bad_request" ? 500 : 503 },
    );
  }
}
