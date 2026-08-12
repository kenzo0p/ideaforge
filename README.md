# 🛠️ IdeaForge — AI-Powered Product Research & Build Plan Copilot

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38BDF8?logo=tailwindcss)](https://tailwindcss.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb)](https://www.mongodb.com/)
[![Anthropic Claude](https://img.shields.io/badge/AI-Claude_3.5_Sonnet-D97706?logo=anthropic)](https://www.anthropic.com/)

> **From "I have an idea" to "I know if it's worth building, and here is the plan" in under 4 minutes — backed by verifiable sources.**

🌐 **Live App**: [https://ideaforge-2e1m.onrender.com](https://ideaforge-2e1m.onrender.com)

---

## 📖 Overview

Turning a raw concept into an actionable project plan usually takes founders, hackathon participants, and researchers 1 to 2 weeks of endless browser tabs, unverified claims, and manual structure design.

**IdeaForge** is an end-to-end research and build plan copilot. It takes a one-line idea and delivers:
1. **Honest Problem Validation & Severity Scoring**: Evaluates whether the pain point is real, assigns a numerical severity score, and highlights existing market saturation.
2. **Deep Search Briefing with Real Citations**: Performs live web searches, grounding every claim in cited sources. **No hallucinated links** — URLs are strictly derived from search results and pruned if unreferenced.
3. **Structured Technical Build Plan**: Generates custom tech stack recommendations, phased milestones, and fetches real codebases (GitHub), datasets (Kaggle), academic papers (CORE/arXiv), and video tutorials (YouTube).
4. **Multi-Format Deliverable Export**: Converts research & build plans into presentation-ready PowerPoint decks (`.pptx`), Word documents (`.docx`), Markdown (`.md`), or printable PDFs with a single click.

---

## ✨ Key Features

- ⚡ **Instant Idea Validation & Brutal Feedback**: Forces the AI model to commit to an interpretation before scoring severity (1–10), reach, and feasibility. Will explicitly advise *against* building weak or saturated ideas.
- 🔎 **Citation-Grounded Research Engine**: Combines Claude 3.5 Sonnet with Tavily Search API. Every bracketed citation links directly to verified source URLs; unused sources are automatically filtered out.
- ⚖️ **Deterministic Multi-Idea Comparison**: Compare up to 3 ideas side-by-side. The AI scores each candidate across dimensions while deterministic code calculates weighted totals and rankings.
- 🛠️ **Tailored Technical Stack & Resource Aggregation**: Recommends domain-specific tech stacks with explicit rationale and queries live APIs to attach relevant GitHub repositories, Kaggle datasets, and CORE research papers.
- 📊 **Pitch Deck Review**: Upload `.pptx` or `.pdf` pitch decks to receive an automated score, section-by-section breakdown, missing slides analysis, and actionable improvement recommendations.
- 💡 **Domain Problem Discovery**: For users without an idea, IdeaForge mines live signals across domain verticals (e.g., student life, rural healthcare, developer tooling) to surface real-world problems worth solving.
- 👥 **Real-Time Workspaces & Collaboration**: Shared project hubs supporting read-only public links, internal `@username` collaboration invites, and live status propagation powered by Server-Sent Events (SSE).
- 📱 **Telegram Bot Agent**: Omnichannel integration allowing users to query project status (`/next`, `/projects`), trigger research updates, and receive automated reminder notifications on Telegram.
- 🧪 **Built-In AI Evaluation Framework**: Custom test suite (`npm run eval`) for benchmarking model honesty, candidate ranking accuracy, and prompt robustness against gold-standard baselines.

---

## 🏗️ Tech Stack & Architecture

| Component | Technology / Service | Description |
|---|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript | Server & Client components with dynamic streaming UI |
| **Styling** | Tailwind CSS v4, Lucide Icons | Responsive, dark/light themes verified for WCAG AA contrast |
| **Database** | MongoDB Atlas | Cloud document store with native connection pooling |
| **AI / LLM** | Claude 3.5 Sonnet (Anthropic API) | Multi-step reasoning, validation, synthesis, and planning |
| **Search Engine** | Tavily API | Real-time web search for citation-backed briefings |
| **Resource APIs** | GitHub REST API, Kaggle API, CORE API, YouTube API | Direct retrieval of open-source repos, datasets, & literature |
| **Authentication** | Firebase Auth / Server-Verified Google OAuth | OAuth token validation against Google public keys & JWT sessions (`jose`) |
| **Document Export** | `pptxgenjs`, `docx`, `pdfjs-dist`, `jszip` | Native binary generation of PowerPoint, Word, & PDF documents |
| **Messaging / Bot** | Telegram Bot API | Long-polling (dev) & Webhooks (production) for remote project management |
| **Testing / Eval** | Custom Node.js ES Module Eval Suite | Automated LLM output regression testing & evaluation |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20.0.0 or higher
- **Package Manager**: `npm`
- **Database**: MongoDB Atlas connection string (or local MongoDB)

### Environment Setup

Create a `.env.local` file in the root directory:

```env
# Required
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/ideaforge
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Recommended (Integrations)
TAVILY_API_KEY=your_tavily_api_key
GITHUB_TOKEN=your_github_token
KAGGLE_API_KEY=your_kaggle_api_key
CORE_API_KEY=your_core_api_key
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=noreply@yourdomain.com
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret
```

### Installation & Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/ideaforge.git
   cd ideaforge
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify Database Connection**:
   ```bash
   npm run test:db
   ```

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Evaluation & Quality Control

IdeaForge includes a built-in evaluation framework to test AI quality, honesty, ranking accuracy, and robustness:

```bash
# Run full evaluation suite
npm run eval

# Fast evaluation on specific tags
npm run eval:fast

# Update evaluation baselines
npm run eval:baseline
```

---

## 🌐 Deployment

IdeaForge is production-ready for deployment on **Render** (recommended for persistent background workers & Telegram polling) or **Vercel** (serverless functions with webhook integration).

- **Health Check Endpoint**: `/api/health` reports system status for AI providers, search engines, and MongoDB connection.

For complete deployment step-by-step instructions, see [DEPLOY.md](file:///c:/Users/Gajanand/OneDrive/Desktop/ideaforge/DEPLOY.md).

---

## 💼 Resume Highlights (3 Simple Bullet Points)

Add these high-impact bullet points to your resume under your Projects / Experience section:

- **Architected Full-Stack AI Research Platform**: Built **IdeaForge** using **Next.js 16**, **React 19**, and **MongoDB Atlas** to automate startup and hackathon project research, delivering validated problem severity scores, technical build plans, and multi-format document exports (`.pptx`, `.docx`, PDF) in under 4 minutes.
- **Engineered Citation-Grounded LLM Pipeline**: Integrated **Claude 3.5 Sonnet** and **Tavily Search API** with custom verification logic that prevents link hallucination by strictly constraining AI references to real web search results and auto-pruning off-topic sources.
- **Implemented Real-Time Sync & Multi-API Integrations**: Developed real-time multi-user workspace synchronization using **Server-Sent Events (SSE)**, connected external APIs (**GitHub**, **Kaggle**, **CORE**) for automated resource discovery, and built a **Telegram bot agent** for remote project tracking and scheduled notifications.
