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
- **Multilingual** — an 8-language selector threads a BCP-47 `locale` through every prompt, so a
  live model responds in the chosen language across validation, research, plan, and the agent.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000  (uses 3005 in a shared setup)
```

No keys needed — it starts on the **Demo (offline)** provider. To use a live model, copy
`.env.example` to `.env.local` and set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · streaming API routes.
