import { redirect } from "next/navigation";
import { KeyRound, Send, Settings as SettingsIcon, ShieldAlert, User } from "lucide-react";
import ConnectTelegram from "@/components/ConnectTelegram";
import {
  DeleteAccountForm,
  PasswordForm,
  ProfileForm,
} from "@/components/SettingsForms";
import { getCurrentUser } from "@/lib/auth/session";
import { isTelegramLinked } from "@/lib/db/telegram";
import { isTelegramConfigured } from "@/lib/agents/telegram";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const telegramConfigured = isTelegramConfigured();
  const telegramLinked = telegramConfigured && await isTelegramLinked(user.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <SettingsIcon className="size-6 text-brand" />
        Settings
      </h1>
      <p className="mb-8 text-sm text-muted">Manage your profile, security, and integrations.</p>

      <div className="space-y-5">
        <Card icon={<User className="size-4 text-brand" />} title="Profile">
          <ProfileForm name={user.name} locale={user.locale} email={user.email} />
        </Card>

        {telegramConfigured && (
          <Card icon={<Send className="size-4 text-brand" />} title="Integrations">
            <ConnectTelegram linked={telegramLinked} />
          </Card>
        )}

        <Card icon={<KeyRound className="size-4 text-brand" />} title="Password">
          <PasswordForm />
        </Card>

        <Card
          icon={<ShieldAlert className="size-4 text-rose-500" />}
          title="Danger zone"
          danger
        >
          <DeleteAccountForm />
        </Card>
      </div>
    </main>
  );
}

function Card({
  icon,
  title,
  danger = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border bg-card p-5 shadow-sm ${
        danger ? "border-rose-500/30" : "border-border"
      }`}
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}
