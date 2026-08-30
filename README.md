# Scrutan — Proof before you build.

Most AI tools will happily tell you your idea is brilliant. **Scrutan scrutinises it.**

Drop in a one-line idea and Scrutan scores how real the problem is, researches it against
live web sources, compares it against what already exists, and produces a buildable plan —
then **opens every citation it produced** to confirm the source is reachable and actually
says what it was cited for. The headline number on a Scrutan brief is not how good the idea
sounds; it is what fraction of its evidence survived being checked.

> Enter: _"Build an AI solution to reduce food waste in college hostels."_
> Get back: problem validation → research → solution comparison → innovation gaps →
> architecture → roadmap → tech stack → repos, APIs & datasets → timeline → deck-ready docs
> → **a grounding score over every source cited.**

### What it refuses to do

- **Invent a link.** The model is handed numbered search results and can only cite by
  number. It is never in a position to write a URL.
- **Flatter you.** Validation carries an explicit severity score, and the eval suite has
  eight cases whose pass condition is that a weak or crowded idea gets called weak.
- **Assert its own honesty.** Every claim above is checked by `npm run eval` against a
  30-case golden set, with baseline-relative regression detection — and the result is
  published, failures included, at `/quality`.

## Everything that ships

| Area | Scope |
|------|-------|
| **Validate** | Streamed problem validation with a severity score, refined problem statement and v1 scope |
| **Research** | DeepSearch over live web results, numbered citations, solution comparison, innovation gaps |
| **Verify** | Every cited URL fetched and classified `verified` / `mismatch` / `dead` / `unreachable` |
| **Check the claims** | Every sentence matched against passages from the source cited for it — with the supporting passage shown, or the fact that there isn't one |
| **Count the real sources** | *"12 citations, but 5 independent sources — 6 trace to one press release"* |
| **Watch it decay** | Stored checks re-run on a schedule: *"3 of the 12 sources have died since you wrote this"* — and, for pages still online, *"this one no longer contains the passage your claim was based on"* |
| **Plan** | Milestones, architecture, tech stack, API recommendations, timeline, knowledge clusters |
| **Check the plan** | The roadmap solved as a dependency graph: critical path, slack, and *"this says 8 weeks and needs 10"* |
| **Check itself** | 13 rules comparing validation, research and plan against each other — dangling citations, architecture wired to nothing, *"scored 3/10 and planned anyway"* |
| **Build with** | Real repos, datasets and papers from GitHub, Kaggle, CORE and YouTube |
| **Keep** | MongoDB-backed projects, version history, workspaces, comments, collaborators, live updates |
| **Share** | Public/unlisted briefs, `.pptx` / `.docx` / `.md` / PDF export, Notion and Google Docs push |
| **Audit a cohort** | Every idea in a workspace compared against every other; lookalikes grouped for a guide to read side by side |
| **Around it** | Orgs with domain join, plans and entitlements, Telegram agent, reminders, 8 languages |

## Architecture

Two clean seams keep features decoupled from vendors:

```
UI / API routes
      │
      ▼
lib/pipeline/*    ← the Scrutan pipeline (one method per stage)
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
- **`lib/pipeline`** — `ScrutanPipeline` is the single seam every feature calls. Changing what
  powers a stage means editing only `lib/pipeline/index.ts`. Covers **problem discovery**
  (find real problems worth solving in a domain, grounded in live web signals), validation,
  DeepSearch, Project HUB, and knowledge clustering.
- **`lib/verify`** — the part the rest of the category doesn't have, in two layers.
  *Citations*: every URL is fetched, and the result is split three ways — reachable,
  relevant to the title it was cited under, and therefore verified; a dead link and a live
  page about something else are different failures, so they are reported apart.
  *Claims*: the harder question, and the one people assume the first answers. A real, live,
  on-topic source can still be attached to a sentence it never contained. So the briefing is
  cut into sentences (`segment.ts` — abbreviation-, decimal- and marker-aware, because
  `split(".")` is wrong in five ways that occur in ordinary output), each cited source is
  cut into overlapping passages (`chunk.ts`), both are embedded with the local model, and
  the best-matching passage becomes the evidence shown next to the claim.

  The thresholds are **measured, not chosen** (`npm run eval:claims`): 50 hand-labelled
  claim/passage pairs, swept, with the two cut-offs picked by a stated rule — the supported
  bar is the lowest with ≥95% precision, the weak bar the highest with ≥95% recall. That
  calibration produced the finding the design now turns on: **passages that contradict a
  claim score higher on average (0.554) than passages that genuinely paraphrase it (0.531)**,
  because an embedding encodes subject matter and a denial is about the same subject as the
  assertion it denies. No threshold can separate them, so the two catchable cases are
  checked literally instead — figures (including spelled-out ones, in either notation) and
  explicit refutations scoped to the claim's own subject. The cut-offs are stored **per
  model**, because the two embedders live in different numeric ranges and sharing a constant
  would put every claim below the weak bar on the fallback, telling every user their whole
  briefing was fabricated. An uncalibrated model produces no verdicts at all.

  *Drift* (`shingle.ts`, `evidence.ts`): link rot is the easy half. The harder failure is a
  page that stays up, keeps its URL and title, and quietly loses the paragraph that was
  cited — an edited statistic, a story rewritten in place. Catching it means comparing the
  page against what it used to be, which sounds like archiving every cited page forever. It
  is not: a SHA-256 answers "did anything change" in 32 bytes, and a 128-wide **MinHash
  sketch** over 5-word shingles estimates how much changed in ~512 bytes, without either
  document being present. So the store is half a kilobyte per source and never holds anyone
  else's text. Whether *your* passage survived is a separate question with a separate
  answer, taken from the claim check's own quotations — a page can be almost entirely
  rewritten and still contain the line you cited, or barely touched and have lost exactly
  it.

  *Independence* (`simhash.ts`, `independence.ts`): a briefing citing twelve URLs reads as
  though twelve parties looked at the question. Often six are one press release reprinted
  across trade sites and three are pages on one vendor's own domain, so the number of people
  who actually investigated anything is two. Nobody measures this, though it is the number
  that decides what a briefing is worth. Two collapses are checkable without a model — same
  registrable publisher (with a curated multi-part suffix list, so `bbc.co.uk` does not
  reduce to `co.uk`), and the same text republished elsewhere, caught by a 64-bit **SimHash**
  at a Hamming threshold measured from fixtures (reprints land 2–15 bits apart, independent
  writing 29–38; the cut-off sits at 18, near the low end of that gap because a false merge
  understates evidence someone actually has). Union-find over both link types gives the
  independent-source count, and normalised Shannon entropy over the publisher distribution
  gives the concentration figure.
- **`lib/similarity`** — embeddings behind the same kind of seam, powering "has someone
  already proposed this?" within a workspace. Two implementations with measured, documented
  behaviour: the neural one separates paraphrases from unrelated ideas, the lexical fallback
  demonstrably cannot, and it says so in the log rather than pretending.
- **`lib/plan`** — the same move as citation verification, applied to the roadmap. A model
  asked for a timeline produces something that *reads* like a schedule; nothing checks that
  milestone four can start when it says it does. Given the durations and dependencies the
  model declares, that is arithmetic — cycle detection by DFS colouring, Kahn's algorithm for
  the ordering, forward and backward passes for earliest/latest start and slack, longest path
  for the critical path. It reports loops, milestones scheduled before their prerequisites
  finish, dependencies that do not exist, and the one people care about: a plan whose own
  dependencies need more weeks than its labels claim. A plan predating the dependency field
  is sequenced as a chain and says so, because with an assumed chain everything is critical —
  a fact about the assumption, not about the plan.
- **`lib/verify/consistency.ts`** — a brief is produced by three separate calls and nothing
  ever compared them, so a project can score the problem 3/10 and carry a sixteen-week plan
  for building it; the narrative can cite `[7]` when six sources exist; the architecture can
  wire a component to one that was never defined. Each artifact is internally plausible,
  which is why nobody notices. Thirteen rules, each declaring which artifacts it needs so a
  half-finished project skips rather than misfires. Findings are tiered — a dangling citation
  is a `contradiction` because no reading of it is benign, while "the plan does not address
  one of the three gaps" is a `note`, since focus can be deliberate. Costs nothing (no
  network, no model), so unlike every other check it runs on every page load rather than
  behind a button.
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
- **Version history** — every regeneration snapshots what it replaced, so re-running
  validation no longer destroys the previous verdict. Rapid autosaves coalesce into one
  entry; a restore never does, because folding it in would discard the state being
  replaced and make the restore itself irreversible.
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
EVAL_COOKIE="scrutan_session=…" npm run eval            # all 30 cases
EVAL_COOKIE="…" npm run eval:publish                      # publish the scoreboard to /quality
EVAL_COOKIE="…" npm run eval:fast                         # deploy gate, no live search
EVAL_COOKIE="…" npm run eval -- --tag=grounding --repeat=3
EVAL_COOKIE="…" npm run eval:baseline                     # record the current run
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · streaming API routes.
