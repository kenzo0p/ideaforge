// ---------------------------------------------------------------------------
// Classifying a dependency failure.
//
// Written after an Anthropic key ran out of credit mid-session. Two things went
// wrong and neither was the outage itself:
//
//   • Every user saw the provider's raw JSON — billing state, provider name and
//     a request id — streamed straight into the page.
//   • Nothing anywhere knew the product had stopped working.
//
// So a failure needs two renderings: one for the operator with the whole
// message, and one for the user that says what it means for them and nothing
// about our vendors.
// ---------------------------------------------------------------------------

export type FailureKind =
  /** Our account is the problem: no credit, bad key, suspended. Won't self-heal. */
  | "outage"
  /** Too many requests. Self-heals, and quickly. */
  | "rate_limit"
  /** Network, timeout, 5xx. Usually self-heals; retrying is reasonable. */
  | "transient"
  /** We sent something the provider rejected. A bug on our side. */
  | "bad_request";

export interface ClassifiedFailure {
  kind: FailureKind;
  /** Safe to show a user. Never names the vendor or quotes their response. */
  userMessage: string;
  /** Full text, for logs and the admin view. Never sent to a browser. */
  detail: string;
  /** Whether this clears on its own, or needs someone to do something. */
  selfHealing: boolean;
}

const RATE_LIMIT = /rate.?limit|too many requests|\b429\b|overloaded|capacity/i;
// `[-_ ]?` rather than `[_ ]?` because the message that matters most in
// practice is Anthropic's literal "invalid x-api-key", which the narrower
// pattern missed — a dead key was being filed as a bug in our own code.
const OUTAGE =
  /credit balance|billing|insufficient[-_ ]?quota|payment|invalid[-_ ]?(x[-_])?api[-_ ]?key|api[-_ ]?key[-_ ]?(invalid|expired)|authentication|unauthorized|\b401\b|\b403\b|suspended|deactivated/i;
const TRANSIENT =
  /fetch failed|terminated|socket|econnreset|etimedout|enotfound|network|timeout|abort|\b50[0234]\b/i;

/**
 * Work out what kind of failure this is, and what a user should be told.
 *
 * Order matters. An overloaded provider often returns a 429 whose body also
 * mentions billing, and calling that an outage would alert someone about
 * something that clears itself in a minute.
 */
export function classifyFailure(err: unknown): ClassifiedFailure {
  const detail = err instanceof Error ? err.message : String(err);

  if (RATE_LIMIT.test(detail)) {
    return {
      kind: "rate_limit",
      userMessage: "We're getting more requests than usual right now — try again in a moment.",
      detail,
      selfHealing: true,
    };
  }
  if (OUTAGE.test(detail)) {
    return {
      kind: "outage",
      // Deliberately vague about the cause. "Our AI vendor's billing failed" is
      // not something a user can act on, and it isn't theirs to know.
      userMessage:
        "The AI service is unavailable right now. This is on our side, not yours — we've been alerted.",
      detail,
      selfHealing: false,
    };
  }
  if (TRANSIENT.test(detail)) {
    return {
      kind: "transient",
      userMessage: "That didn't go through. Try again — it usually works on a second attempt.",
      detail,
      selfHealing: true,
    };
  }
  return {
    kind: "bad_request",
    userMessage: "Something went wrong generating that. We've logged it and will take a look.",
    detail,
    selfHealing: false,
  };
}
