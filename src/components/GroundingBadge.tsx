import { HelpCircle, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import {
  BAND_CLASS,
  BAND_LABEL,
  groundingBand,
  groundingPercent,
  type GroundingBand,
} from "@/lib/verify/score";

const ICON: Record<GroundingBand, typeof ShieldCheck> = {
  strong: ShieldCheck,
  mixed: ShieldAlert,
  weak: ShieldX,
  unchecked: HelpCircle,
};

/**
 * The score, wherever it needs to be seen.
 *
 * A server component on purpose: it renders on a public brief that has no
 * session and no JavaScript worth shipping, and the number never changes
 * without a page load.
 *
 * `verified`/`total` are shown alongside the percentage rather than instead of
 * it, because a percentage with no denominator is the exact shape of claim
 * this product exists to distrust.
 */
export default function GroundingBadge({
  score,
  verified,
  total,
  size = "sm",
  showLabel = true,
}: {
  score: number | null;
  verified?: number;
  total?: number;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const band = groundingBand(score);
  const Icon = ICON[band];
  const pad = size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]";
  const iconSize = size === "md" ? "size-4" : "size-3";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad} ${BAND_CLASS[band]}`}
      title={
        total === undefined
          ? BAND_LABEL[band]
          : `${verified ?? 0} of ${total} cited sources were fetched and matched what they were cited for`
      }
    >
      <Icon className={`${iconSize} shrink-0`} />
      {score === null ? (
        <span>Unchecked</span>
      ) : (
        <>
          <span className="tabular-nums font-semibold">{groundingPercent(score)}%</span>
          {showLabel && <span>grounded</span>}
          {total !== undefined && (
            <span className="tabular-nums opacity-70">
              ({verified ?? 0}/{total})
            </span>
          )}
        </>
      )}
    </span>
  );
}
