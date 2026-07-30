import { headers } from "next/headers";

/**
 * The origin the *browser* used to reach us, e.g. https://ideaforge.onrender.com
 *
 * Never derive this from `request.url`. Behind a proxy — Render, Vercel, Fly,
 * anything with a load balancer — that is the internal listen address, so a
 * redirect built from it sends the visitor to `https://localhost:10000/…`,
 * which is a dead link from their machine. The forwarded headers are the only
 * thing that carries the public origin.
 */
export async function publicOrigin(): Promise<string> {
  const h = await headers();
  // x-forwarded-host wins: some proxies rewrite Host to the internal target.
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3005";
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0].trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Absolute URL for a path on the public origin. */
export async function publicUrl(path: string): Promise<string> {
  return new URL(path, `${await publicOrigin()}/`).toString();
}
