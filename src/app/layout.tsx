import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { getCurrentUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/db/projects";
import { unreadNotificationCount } from "@/lib/db/reminders";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IdeaForge — Search Less. Solve More.",
  description:
    "An AI research & innovation copilot that turns a one-line idea into a validated, buildable project. Powered by iNSIGHTS Layer 2.",
};

/**
 * The theme cookie is rendered straight onto <html>, so the correct palette is
 * present in the very first byte of HTML — no flash and no blocking script.
 * When it's absent, CSS falls back to the OS `prefers-color-scheme`.
 */
async function themeClass(): Promise<string> {
  const theme = (await cookies()).get("theme")?.value;
  return theme === "dark" || theme === "light" ? theme : "";
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  // Full list powers the ⌘K palette; the sidebar shows the first few.
  const projects = user
    ? listProjects(user.id)
        .slice(0, 50)
        .map((p) => ({ id: p.id, title: p.title }))
    : [];
  const unread = user ? unreadNotificationCount(user.id, user.notificationsSeenAt) : 0;
  const theme = await themeClass();

  return (
    <html
      lang="en"
      className={`${theme} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell
          user={user ? { email: user.email } : null}
          projects={projects}
          unreadCount={unread}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
