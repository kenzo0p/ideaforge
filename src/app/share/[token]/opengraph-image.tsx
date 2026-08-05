import { ImageResponse } from "next/og";
import { getProjectByShareToken } from "@/lib/db/projects";

// A link preview is the whole first impression when a brief is posted to a
// group chat or a timeline. Rendered here rather than as a static file so the
// card carries the actual idea — a generic logo card converts far worse.

export const runtime = "nodejs";
export const alt = "IdeaForge brief";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The teal-and-sand palette, hard-coded: this renders outside the document, so
// there are no CSS variables to read.
const INK = "#0f2b2b";
const SAND = "#f6f3ec";
const BRAND = "#177f7f";
const MUTED = "#5b6b6b";

export default async function Image({
  params,
}: {
  // Awaited rather than read directly: route params are a promise in this
  // version, and awaiting a plain object is harmless either way.
  params: Promise<{ token: string }> | { token: string };
}) {
  const { token } = await params;
  const project = await getProjectByShareToken(token);
  const title = project?.title ?? "IdeaForge";
  const idea = project?.idea ?? "An AI research & innovation copilot.";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: SAND,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: BRAND,
              display: "flex",
            }}
          />
          <span style={{ fontSize: 26, fontWeight: 700, color: INK }}>IdeaForge</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: title.length > 60 ? 56 : 68,
              fontWeight: 800,
              color: INK,
              lineHeight: 1.1,
            }}
          >
            {title.slice(0, 96)}
          </div>
          <div style={{ marginTop: 22, fontSize: 30, color: MUTED, lineHeight: 1.35 }}>
            {idea.length > 150 ? `${idea.slice(0, 147)}…` : idea}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ height: 6, width: 72, borderRadius: 3, background: BRAND, display: "flex" }} />
          <span style={{ fontSize: 24, color: MUTED }}>
            Validated problem · researched · planned
          </span>
        </div>
      </div>
    ),
    size,
  );
}
