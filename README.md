# IdeaForge — Search Less. Solve More.

An **AI-powered Research & Innovation Copilot for students**, built for the **iNSIGHTS Track**.
Drop in a one-line idea and IdeaForge takes you from *problem discovery* to a *validated,
buildable project* — problem validation, citation-backed research, an auto-generated build
plan, and the resources to ship it.

> Enter: _"Build an AI solution to reduce food waste in college hostels."_
> Get back: problem validation → research → solution comparison → innovation gaps →
> architecture → roadmap → tech stack → repos, APIs & datasets → timeline → deck-ready docs.

## Status — built in parts

| Part | Scope | Status |
|------|-------|--------|
| **1** | Foundation: provider abstraction, iNSIGHTS Layer 2 service seam, idea → **problem validation** (streamed) | ✅ Done |
| **2** | **DeepSearch** + **Real-time Web Intelligence** — web search, citation-backed research, solution comparison, gaps | ✅ Done |
| **3** | **Project HUB** + **Knowledge Clustering** — milestones, architecture, stack, APIs, timeline; repos/datasets/papers | ✅ Done |
| **4** | **Personalized Dashboards** + **Research Workspaces** — MongoDB persistence, save/open projects, sources/notes/decisions | ✅ Done |
| **5** | **AI Agents** (in-app console + Telegram webhook) + **Multilingual** (8-language selector, locale threaded end-to-end) | ✅ Done |

The brief requires **≥4** Layer 2 capabilities; **all eight are live.** 🎉

## Architecture

Two clean seams keep features decoupled from vendors:

```
UI / API routes
      │
      ▼
lib/insights/layer2.ts   ← the iNSIGHTS Layer 2 service (one method per capability)
      │            │
      ▼            ▼
lib/ai/*        lib/search/*   ← swappable AI provider + web-search provider
(OpenAI·Anthropic·Mock)        (Tavily·Mock)
```

- **`lib/ai`** — a tiny `AIProvider` interface (`streamText` / `generateText`) with three
  implementations. `getProvider()` auto-selects from env. The **Mock** provider synthesizes
  realistic output locally, so the whole app runs with **zero API keys**.
- **`lib/search`** — a `SearchProvider` interface powering DeepSearch. **Tavily** for live web
  results, **Mock** for offline demos (clearly labeled in the UI).
- **`lib/insights`** — `Layer2Service` is the single seam the copilot's features call. Swapping
  in the real iNSIGHTS Layer 2 API later means editing only `layer2.ts`. Covers **problem
  discovery** (find real problems worth solving in a domain, grounded in live web signals),
  validation, DeepSearch, Project HUB, and knowledge clustering.
- **`lib/email`** — swappable mailer (console dev / Resend prod) powering email verification,
  with a graceful fallback link when a real send can't be delivered.
- **`lib/db`** — **MongoDB** persistence, one repository module per aggregate. A project is a
  single document: its plan, research, milestone progress and workspace items are all embedded,
  so reads are one round-trip and deleting a project is atomic. Mutations go through Server
  Actions in `lib/actions.ts`. Set `MONGODB_URI`; indexes are created on first boot, and
  short-lived records (sessions, tokens, rate-limit hits) are reaped by TTL indexes.
- **`lib/auth`** — email + password authentication with **no external library**: passwords
  hashed with Node's `crypto.scrypt` (salted), opaque session tokens in an HttpOnly cookie
  backed by a `sessions` table. `getCurrentUser()` gates server components/actions; every
  project is scoped to its owner (`user_id`), so `getProject`/`listProjects` enforce
  authorization at the query level. Guests can use the copilot but must sign in to save.
- **`lib/agents`** — one channel-agnostic `handleAgentMessage()` brain powering both the in-app
  **Agent Console** (`/api/agents/message`) and a **Telegram webhook** (`/api/agents/telegram`).
  Commands (`/status`, `/next`, `/plan`, `/projects`) run locally; free-text is answered by the
  LLM grounded in the project's saved artifacts. Works with no token; connects a real bot when
  `TELEGRAM_BOT_TOKEN` is set (see `.env.example`).
- **`lib/billing`** — plans, entitlements, and the payment provider seam. `plans.ts` is the one
  table describing what each tier gets; `resolve.ts` answers "what plan is this user on?" by
  taking the better of their own subscription and their workspace's; `entitlements.ts` is the
  only place that answers "is this allowed?", so a gate can never be enforced in one route and
  forgotten in its sibling.
- **`lib/db/orgs` + `lib/orgs`** — organisations: a lab, class, or cohort on one plan. Members
  join automatically by verified email domain, and mentors can read and comment on the whole
  workspace's projects without being invited to each one. Domain claims are checked against the
  claimant's own address and public mailbox providers can never be claimed, which is what stops
  a domain claim from being a way to adopt strangers.
- **Public briefs** — a shared brief is unlisted by default; its owner can separately
  list it, which adds it to `/explore`, the sitemap, and search indexes. Everything else is
  `noindex` and the signed-in surface is disallowed by prefix in `robots.txt`, so a new
  private route is private without anyone remembering to add it.
- **Multilingual** — an 8-language selector threads a BCP-47 `locale` through every prompt, so a
  live model responds in the chosen language across validation, research, plan, and the agent.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000  (uses 3005 in a shared setup)
```

No keys needed — it starts on the **Demo (offline)** provider. To use a live model, copy
`.env.example` to `.env.local` and set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

## Checks

```bash
npm run test:db          # every repository function, against a real MongoDB
npm run check:contrast   # WCAG AA contrast across the palette, both themes
npm run eval             # output quality against the golden set (needs a live model)
```

`npm run eval` is the unusual one. The other two test that the code works; this tests
whether the *answers* are any good — the part that decays silently when a prompt is edited
or a model is swapped. Thirty cases assert substance, not wording: that a crowded space is
called crowded, that a geospatial idea produces geospatial tooling, that every `[n]` marker
resolves to a real source, that an instruction hidden in the idea field is analysed rather
than obeyed.

Three things make it usable as a gate rather than a curiosity:

- **Variance is handled.** `--repeat=3` scores each check by majority and reports anything
  that disagreed with itself as *flaky* instead of counting it either way.
- **Regressions beat absolutes.** The pass/fail decision is made against a stored baseline.
  "83% passed" says nothing; "two checks that passed yesterday fail today" is the sentence
  that should stop a deploy.
- **A run that couldn't reach the model reports nothing.** Provider outages — no credit,
  bad key, rate limit — abort the run with the provider's own message and exit `2`, leaving
  the baseline untouched. Without this the harness invents findings: an API key running out
  mid-run once produced a confident "59%, locale is broken" when nothing was wrong.

```bash
EVAL_COOKIE="ideaforge_session=…" npm run eval            # all 30 cases
EVAL_COOKIE="…" npm run eval:fast                         # deploy gate, no live search
EVAL_COOKIE="…" npm run eval -- --tag=grounding --repeat=3
EVAL_COOKIE="…" npm run eval:baseline                     # record the current run
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · streaming API routes.
