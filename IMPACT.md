# IdeaForge — impact, differentiation, and revenue

Live: <https://ideaforge-2e1m.onrender.com>

> **Status, stated plainly.** IdeaForge is a working, deployed product with real
> users possible today. It has **no paying customers and no revenue yet**. The
> figures in [§4](#4-revenue-model) are a model built from measured costs, not
> results — every assumption is labelled. The claims in
> [§3](#3-what-actually-makes-it-different) describe behaviour that ships today
> and can be checked in the running app.

---

## 1. The problem

Turning an idea into something you can start building takes a researcher one to
two weeks of unstructured work:

1. **Discovery is unbounded.** You don't know when you've read enough, so you
   read tabs until you're tired rather than until you're informed.
2. **Generic AI can't be trusted here.** Ask a chatbot "has this been built?"
   and you get a fluent answer with invented links. For a decision this
   expensive, an unverifiable answer is worse than none.
3. **Two questions go unanswered.** *Has someone already solved this?* and
   *what do I build first?* — the two that actually determine whether the next
   month is wasted.

The cost of getting this wrong isn't the research time. It's the month spent
building something that already exists.

## 2. Impact

### Who it changes things for

| Audience | Today | With IdeaForge |
|---|---|---|
| **Students** (hackathons, capstones, first research project) | Pick an idea on instinct, discover the incumbent in week three | Know the competitive landscape before committing a weekend |
| **First-time founders** | Validate by asking friends, who are polite | A severity score, named incumbents, and cited gaps |
| **Research students** | Literature review is the barrier to starting | Papers surfaced from CORE and arXiv alongside the briefing |
| **Educators / mentors** | Repeat the same "have you checked X?" every term | Students arrive with the landscape already mapped |

### What is actually measurable

These are the numbers to quote, because they can be checked:

- **Idea to sourced, buildable plan: ~4 minutes.** Measured end to end on the
  deployed app. Validation streams in ~20s, research completes in 28–45s,
  the plan in ~25s.
- **Comparison of three ideas: ~28 seconds**, with a ranked verdict and real
  citations.
- **Every claim traceable.** The model never writes a URL; links come only from
  actual search results, and sources the briefing didn't use are dropped.

The honest version of the time claim: this doesn't replace a week of research.
It replaces the *first* week — the orientation phase — and tells you whether the
remaining weeks are worth spending.

### The impact that matters most

Most tools in this space are optimised to make you feel good about your idea.
IdeaForge will tell you an idea is weak. In testing, asked to compare three
ideas, it scored a water-reminder app **2/10 on severity, 1/10 on
differentiation** and wrote *"Not worth building — the problem is mild, the
market is saturated."*

**Talking someone out of the wrong project is worth more than helping them plan
the wrong project well.**

---

## 3. What actually makes it different

### Against the alternatives

| | ChatGPT / Claude | Perplexity | Elicit / Consensus | Notion AI | **IdeaForge** |
|---|---|---|---|---|---|
| Cited, checkable sources | ✗ invented links | ✓ | ✓ papers only | ✗ | ✓ |
| Says an idea is *not* worth building | rarely | ✗ | ✗ | ✗ | **✓ scored** |
| Ranks competing ideas | ✗ | ✗ | ✗ | ✗ | **✓ deterministic** |
| Finds real repos + datasets | ✗ | ✗ | ✗ | ✗ | **✓ GitHub, Kaggle, CORE** |
| Produces a build plan | prose | ✗ | ✗ | template | ✓ structured |
| Output is a durable project | ✗ chat log | ✗ | library | doc | ✓ with collaborators |
| Exports to deck / Word | ✗ | ✗ | ✗ | partial | ✓ .pptx, .docx, .md, PDF |

### The four differences that are structural, not cosmetic

Each of these is an engineering decision, which is why a competitor can't add it
by changing a prompt.

**1. URLs cannot be hallucinated — by construction.**
The model is handed numbered search results and can only reference them by
number. It is never in a position to write a link. Sources the briefing didn't
cite are then pruned, so the list is what the analysis *used*, not what search
happened to return.

**2. The model scores; the code ranks.**
In comparison mode the model rates each idea on severity, reach, feasibility and
differentiation. The weighted total and the ordering are computed in code. The
recommendation can never contradict the numbers on screen — and the prompt
explicitly forbids scoring everything a 7, because a comparison where everything
wins is worthless.

**3. Resources come from dedicated APIs, not from the model.**
GitHub for repositories, Kaggle for datasets, CORE for papers, plus related
YouTube tutorials. Anything that doesn't share vocabulary with the idea is
filtered out rather than shown as a confident wrong answer.

**4. The output is a project, not a transcript.**
Validation, research, plan, workspace and discussion persist, and collaborators
join by `@username` with invitations delivered inside the app — no email
provider involved. Changes propagate live over Server-Sent Events.

### Also shipped

Problem discovery (find a problem without having an idea), deck review (upload a
`.pptx`/`.pdf` and get a scored critique), a Telegram agent for status and
reminders, Google sign-in, multilingual output, and WCAG-AA verified theming in
light and dark.

---

## 4. Revenue model

### Unit economics, from measured usage

A complete project — validate, research, plan — costs, per run:

| Resource | Measured usage |
|---|---|
| LLM calls | 3 (validation 1.2k, research 8k, plan 6k output-token ceiling) |
| Web searches | up to 9 (4 briefing, 3 resource fallback, 2 video) |
| Resource API calls | 3 (GitHub, Kaggle, CORE) — free tiers |

> **Assumption to verify before quoting.** Cost per project depends on current
> Anthropic and Tavily pricing; check both before putting a number in a deck.
> The arithmetic is: `3 LLM calls (≈15k output tokens ceiling) + 9 searches`.
> Typical runs use well under the ceiling. Substitute today's rates to get a
> real per-project figure.

The rate limiter allows 20 copilot calls per minute per user, so **there is
currently no cumulative spend cap** — see [§6](#6-what-is-not-solved-yet).

### Tiers

| Tier | Price | Includes | Who it's for |
|---|---|---|---|
| **Free** | ₹0 | 3 projects, full research and plan, exports | Students trying it |
| **Pro** | ₹399/mo | Unlimited projects, comparison mode, collaboration, Telegram agent | Founders, final-year students |
| **Team** | ₹1,499/mo | 5 seats, shared workspace, priority runs | Hackathon teams, labs |
| **Campus** | ₹40k–₹1.5L/yr | Unlimited students, admin dashboard, custom domains | Universities, incubators |

Pricing is anchored to the Indian student market, where a ₹399 subscription is
plausible and a $20 one is not.

### Why Campus is the real business

Consumer subscriptions on a student audience churn hard — the tool is used
intensely for a few weeks, then not until next term. Institutions have the
opposite shape:

- **Recurring by nature.** Every incubator runs cohorts; every college runs final-year projects.
- **Budget already exists.** Innovation cells and incubation centres have line items for exactly this.
- **The buyer feels the pain.** Mentors repeat the same "have you checked X?" every term.
- **One sale, hundreds of users**, and usage is bounded by term dates, which makes cost predictable.

**Path:** free tier for reach → Pro conversion from serious individuals → Campus
as the durable revenue line.

### Other revenue, honestly ranked

- **Realistic:** sponsored dataset/API placements in the resources rail — relevant, and already the surface people click.
- **Speculative:** anonymised trend data on what students are trying to build. Interesting to accelerators, but needs scale and a clear consent story before it's sellable.

---

## 5. Costs today

Running the deployed app right now:

| Component | Tier | Cost |
|---|---|---|
| Render (web service) | Free / Starter | ₹0 – ₹600/mo |
| MongoDB Atlas | M0 free | ₹0 |
| GitHub / Kaggle / CORE | Free tiers | ₹0 |
| Firebase Auth | Spark | ₹0 |
| Anthropic + Tavily | Pay-as-you-go | **the only variable cost** |

Infrastructure is effectively free; the entire cost structure is per-run AI and
search. That makes usage-based pricing the natural fit and keeps the free tier
affordable — but it also means an uncapped free tier is a real financial risk.

---

## 6. What is not solved yet

Stating these before a judge finds them is worth more than hiding them.

1. **No cumulative spend cap.** Rate limiting is per-minute, not per-day. A
   single account could run up a substantial bill. This is the first thing to
   fix before any marketing push.
2. **No paying users.** Everything in §4 is a model.
3. **Quality is not yet measured.** Output is good in testing, but there's no
   evaluation harness scoring it against a golden set — so "it gives good plans"
   is currently an opinion, not a metric.
4. **Real-time is single-instance.** The SSE fan-out lives in one process's
   memory; scaling to multiple instances needs Redis pub/sub.
5. **Retention is unproven.** The natural usage pattern is intense-then-idle,
   which is exactly why the institutional tier matters more than the consumer one.

---

## 7. The one-paragraph version

> Going from "I have an idea" to "I know whether it's worth building, and here's
> the plan" takes a researcher one to two weeks. IdeaForge does the first week in
> four minutes, and shows its sources. Unlike a chatbot, it can't invent a link —
> every citation comes from a real search result. Unlike research tools, it ends
> with a build plan, real repos and datasets, and a project your team can work in
> together. And unlike anything optimised for engagement, it will tell you an idea
> isn't worth building.
