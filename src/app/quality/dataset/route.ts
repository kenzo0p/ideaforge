import pairs from "@/../scripts/eval/claim-pairs.json";

// The labelled set the thresholds are derived from, served as a file.
//
// Read from the same path the calibration script reads, rather than copied into
// `public/`. A copy would drift, and a published dataset that quietly disagreed
// with the one the numbers came from would be worse than not publishing it.
export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(pairs, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="scrutan-claim-pairs.json"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
