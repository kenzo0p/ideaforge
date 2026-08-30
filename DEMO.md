# Scrutan — demo script

Live: <https://ideaforge-2e1m.onrender.com>

Two versions below. **Run the 4-minute one** unless you're told otherwise; the
60-second version is for corridor conversations and judges walking past.

Read the **Before you present** checklist first — half of demo failures are
setup, not code.

---

## The one-liner

> Going from "I have an idea" to "I know if it's worth building, and here's the
> plan" takes a researcher two weeks. Scrutan does it in four minutes, and
> shows its sources.

## The problem, in three sentences

1. Every student and founder starts with an idea and 40 browser tabs.
2. Generic AI chat gives you confident answers with no sources, so you can't
   tell what's real.
3. You still don't know the two things that matter: **has someone already built
   this**, and **what do I actually do on Monday morning**.

---

# The 4-minute demo

Timings are speaking time. Practice once with a stopwatch.

### 0:00 — Hook (20s)

*Land on the home page. Don't sign in yet.*

> "Everyone here has had an idea and then lost a weekend to browser tabs.
> Scrutan is a research copilot that takes a one-line idea and gives you back
> three things: is this problem real, has it been solved, and what do I build
> first. Every claim it makes is linked to a source."

### 0:20 — Sign in (15s)

*Click **Continue with Google**.*

> "Sign in is Google — no passwords, no waiting for a verification email."

Talking point if asked: the Google token is verified **server-side** against
Google's public keys before any account is created. Firebase never holds the
session; the app issues its own.

### 0:35 — Validate the idea (60s)

*Paste a prepared idea. Use one that isn't obviously good — a real one.*

Suggested: `A campus tool that matches students to research labs by interest`

*Click **Validate idea**. Talk while it streams.*

> "It's restating the problem in its own words first — that's deliberate, it
> forces the model to commit to an interpretation before judging it."

*When the verdict appears, read the severity score out loud.*

> "Severity 5 out of 10, and notice it pushes back — it says the pain is real
> but narrow. It's not here to flatter you. That matters: most of the value in
> research is finding out early that something isn't worth building."

### 1:35 — Research with citations (60s)

*Click the **Research** tab.*

> "Now DeepSearch. This runs real web searches, then the model writes a briefing
> grounded in what came back."

*Scroll to the sources list. Click one open.*

> "Every bracketed number is a real link. And we only list sources the briefing
> actually used — if a search result was off-topic, it doesn't appear. That's
> the difference between citations and decoration."

*Point at existing solutions.*

> "It also finds who's already doing this, and where the gaps are."

### 2:35 — The build plan (50s)

*Click the **Plan** tab.*

> "This is the part I'd have spent a week on."

*Scroll through, calling out:*

- **Tech stack** — with a reason per choice, not just names
- **Milestones** — tick one to show progress tracking
- **APIs and datasets** — real repos and papers, pulled from GitHub and CORE

> "Ask it for a geospatial climate tool and it recommends xarray and rasterio
> and the NOAA soil-moisture API. Ask it for a campus app and you get something
> completely different. It's not a template."

### 3:25 — Ship it (25s)

*Click **Export → PowerPoint**. Open the file.*

> "One click to a deck. That's your submission, generated from the work."

### 3:50 — Close (10s)

> "One-line idea to a validated, sourced, buildable plan — in the time this demo
> took. Everything you saw is live at this URL right now."

---

# The 60-second version

> "Scrutan turns a one-line idea into a validated project plan.
>
> You type an idea. It tells you whether the problem is real and scores how
> severe it is — and it will tell you when an idea is weak.
>
> Then it runs live web research and writes you a briefing where every claim
> links to a real source, plus who's already solved this and where the gaps are.
>
> Then it gives you a build plan: stack, architecture, milestones, real datasets
> and papers.
>
> Export it as a deck, share a read-only link, or ask your project questions
> from Telegram.
>
> It's live now — want to try it with your own idea?"

*Then hand them your laptop. Letting a judge type their own idea is the single
most convincing thing you can do.*

---

# If you have extra time

Pick **one**. Don't try to show everything — a rushed tour beats nothing, but a
focused demo beats both.

**Find a problem** (strongest add-on)
> "You don't even need an idea. Pick a domain — rural healthcare, student life —
> and it surfaces real problems worth solving, grounded in live signals."

**Review my deck**
> "Upload your existing pitch deck and it critiques it — score, what's missing,
> section by section." *Honest line that lands well: "We built this to check our
> own deck, and it found a real bug in our slide generator."*

**Telegram agent**
> "Ask your project questions from your phone. `/next` tells you the next step,
> and it can nudge you on a schedule."

**Multilingual**
> Switch the language selector and re-run. "Research and plan in the language
> you think in."

---

# Before you present

- [ ] Open the site and **sign in 10 minutes early** — the free tier sleeps, and
      a cold start takes ~50 seconds. Never demo onto a sleeping server.
- [ ] Have **one project already saved** with validation, research and plan
      complete — your fallback if live generation is slow.
- [ ] Test on the **actual presentation wifi**.
- [ ] Zoom the browser to **125%** so the back row can read it.
- [ ] Close every other tab. Turn off notifications.
- [ ] Pre-type your idea in a notes file to paste — don't type live.
- [ ] Decide your **one** extra feature and cut the rest.

## Don't demo these unless you've checked

| Feature | Only works if |
|---|---|
| Google sign-in | Firebase keys are set in Render **and** your domain is in Firebase → Authentication → Authorised domains |
| Email sign-up | You've set the `SMTP_*` variables — otherwise mail only reaches the Resend account owner |
| Reminders firing | Render is on a paid tier; the free tier sleeps and the scheduler stops |

---

# Likely questions

**"Isn't this just ChatGPT with a prompt?"**
> "Three differences. It runs real web searches and every claim links to a
> source you can open. It pulls real repos, datasets and papers from GitHub,
> Kaggle and CORE — not invented URLs. And the output is structured and saved as
> a project you keep working on, not a chat you scroll back through."

**"How do you know it isn't hallucinating the links?"**
> "We never let the model write a URL. Links come from actual search results;
> the model can only reference them by number. And we drop any source the
> briefing didn't use."

**"What's your stack?"**
> "Next.js 16 and React 19, MongoDB Atlas, Claude for reasoning, Tavily for
> search, plus GitHub, Kaggle and CORE for resources. Every provider sits behind
> an interface, so we can swap any of them without touching feature code."

**"What was the hardest part?"**
> Pick a true one — true stories land, rehearsed ones don't:
> - "Making it give *different* answers for different domains. Early on every
>   idea got the same generic stack. The fix was restructuring the prompts so
>   the model commits to a domain before it designs anything."
> - "Citations. Search returns ten results and only some are relevant — showing
>   all of them made the app look like it endorsed off-topic links."

**"What would you do next?"**
> "Compare mode — validate three ideas side by side and rank them. The whole
> pipeline already exists; it's a UI on top of it."

**"Is it actually deployed?"**
> "Yes — it's live, it's got a real database, and you can sign up right now."

---

# Delivery notes

- **Show, then explain.** Click first, talk while it loads. Silence while
  waiting is what kills demos.
- **Say the number.** "Severity 5 out of 10" is more convincing than "it scores
  the problem".
- **Admit one limitation before they find it.** It buys credibility for
  everything else. Good one: *"Research takes about 30 seconds — we're not
  faking it with cached results."*
- **If something breaks**, don't debug on stage. "Let me show you the saved
  version" and move on. Have it open in another tab.
- **End on the URL**, not on a thank-you slide. You want them typing it in.
