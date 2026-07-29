"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";

/**
 * Cycles system → light → dark. The choice is stored in a cookie so the server
 * can render the right class on <html> (no flash, no blocking script); the class
 * is also flipped here so the change is instant without a reload.
 */
export default function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");

  // Reflect the cookie the server already used, so the label starts correct.
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)theme=(light|dark)/);
    setTheme((m?.[1] as Theme) ?? "system");
  }, []);

  function apply(next: Theme) {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (next !== "system") root.classList.add(next);

    document.cookie =
      next === "system"
        ? "theme=; path=/; max-age=0"
        : `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  }

  const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";

  return (
    <button
      onClick={() => apply(next)}
      title={`Theme: ${label} — click for ${next}`}
      className={`inline-flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-background hover:text-foreground ${
        collapsed ? "justify-center" : ""
      }`}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </button>
  );
}
