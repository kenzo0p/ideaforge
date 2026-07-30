import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs resolves its worker relative to its own package at runtime, which
  // fails once the bundler inlines it — keep it external on the server.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
