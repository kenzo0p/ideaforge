// ---------------------------------------------------------------------------
// The event vocabulary.
//
// A closed list, not free-form strings. Analytics rots when every call site
// invents its own name — you end up with `signup`, `sign_up` and `user_signup`
// counting thirds of the same thing, and no funnel is trustworthy again.
//
// No imports, so the list can be read by the tracker, the funnel queries and
// tests without dragging in the database.
// ---------------------------------------------------------------------------

export const EVENTS = {
  // Acquisition
  SIGNED_UP: "signed_up",
  SIGNED_IN: "signed_in",

  // Activation — the path that decides whether someone ever comes back
  IDEA_VALIDATED: "idea_validated",
  RESEARCH_RUN: "research_run",
  PLAN_GENERATED: "plan_generated",
  PROJECT_SAVED: "project_saved",

  // Engagement
  IDEAS_COMPARED: "ideas_compared",
  DECK_REVIEWED: "deck_reviewed",
  PROBLEM_DISCOVERED: "problem_discovered",
  PROJECT_EXPORTED: "project_exported",
  // Acquisition: a listed brief is a page that can be found by someone who has
  // never heard of the product, which nothing else in the funnel produces.
  BRIEF_LISTED: "brief_listed",
  PUBLIC_BRIEF_VIEWED: "public_brief_viewed",
  COLLABORATOR_INVITED: "collaborator_invited",
  INVITE_ACCEPTED: "invite_accepted",

  // Retention
  WATCH_STARTED: "watch_started",
  WATCH_STOPPED: "watch_stopped",
  WATCH_FINDINGS: "watch_findings",

  // Organisations — tracked apart from consumer subscriptions because one
  // institutional signup is worth dozens of individual ones, and mixing them
  // makes both numbers meaningless.
  ORG_CREATED: "org_created",
  ORG_MEMBER_JOINED: "org_member_joined",
  ORG_PROJECT_VIEWED: "org_project_viewed",

  // Monetisation
  LIMIT_HIT: "limit_hit",
  UPGRADE_PROMPT_SHOWN: "upgrade_prompt_shown",
  UPGRADE_PROMPT_CLICKED: "upgrade_prompt_clicked",
  PRICING_VIEWED: "pricing_viewed",
  CHECKOUT_STARTED: "checkout_started",
  SUBSCRIPTION_ACTIVATED: "subscription_activated",
  SUBSCRIPTION_CANCELLED: "subscription_cancelled",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * The activation funnel, in order.
 *
 * Someone who validates but never runs research got no real value from the
 * product. This sequence is what tells you where that happens.
 */
export const ACTIVATION_FUNNEL: { event: EventName; label: string }[] = [
  { event: EVENTS.SIGNED_UP, label: "Signed up" },
  { event: EVENTS.IDEA_VALIDATED, label: "Validated an idea" },
  { event: EVENTS.RESEARCH_RUN, label: "Ran DeepSearch" },
  { event: EVENTS.PLAN_GENERATED, label: "Generated a plan" },
  { event: EVENTS.PROJECT_SAVED, label: "Saved a project" },
];

/** The path to revenue. */
export const REVENUE_FUNNEL: { event: EventName; label: string }[] = [
  { event: EVENTS.LIMIT_HIT, label: "Hit a limit" },
  // Between the limit and the pricing page: did they even see an offer, and did
  // it move them? Without these two steps a drop-off could be a bad prompt or
  // no prompt at all, and those need opposite fixes.
  { event: EVENTS.UPGRADE_PROMPT_SHOWN, label: "Saw an upgrade prompt" },
  { event: EVENTS.UPGRADE_PROMPT_CLICKED, label: "Clicked upgrade" },
  { event: EVENTS.PRICING_VIEWED, label: "Viewed pricing" },
  { event: EVENTS.CHECKOUT_STARTED, label: "Started checkout" },
  { event: EVENTS.SUBSCRIPTION_ACTIVATED, label: "Subscribed" },
];
