"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Loader2, Send, User } from "lucide-react";

interface Msg {
  role: "user" | "agent";
  text: string;
}

const QUICK = ["/status", "/next", "/plan"];

// Per-project AI Agent chat. Talks to /api/agents/message — the same handler that
// powers the Telegram webhook, so the in-app demo and the real bot behave alike.
export default function AgentConsole({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "agent",
      text: "🤖 Hi! I'm your project agent. Ask me anything, or try /status, /next, or /plan.",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/agents/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, projectId }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "agent", text: data.reply ?? data.error ?? "No response." },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "agent", text: "⚠️ Network error. Try again." }]);
    } finally {
      setPending(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
      );
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Bot className="size-4 text-brand" />
        AI Agent
      </div>
      <p className="mb-4 text-sm text-muted">
        Same brain as the Telegram/WhatsApp bot — grounded in this project.
      </p>

      <div
        ref={scrollRef}
        className="mb-3 max-h-80 space-y-3 overflow-y-auto rounded-xl border border-border bg-background/40 p-3"
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                m.role === "user" ? "bg-brand text-white" : "bg-brand/15 text-brand"
              }`}
            >
              {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
            </div>
            <div
              className={`prose-insights max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-brand text-white"
                  : "border border-border bg-card"
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin text-brand" /> Thinking…
          </div>
        )}
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            disabled={pending}
            className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted transition hover:border-brand/50 hover:text-foreground disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent about this project…"
          className="flex-1 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-brand/60"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-3 py-2 text-white transition hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
