import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth/session";
import { safeInternalPath } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Already signed in and following an invite link? Go straight there.
  if (await getCurrentUser()) redirect(safeInternalPath(next));
  return <AuthForm mode="sign-in" next={next} />;
}
