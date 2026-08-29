import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { HostAuthForm } from "@/components/auth/host-auth-form";

export const metadata: Metadata = {
  title: "Host Login · Zencierge",
  description: "Sign in to your Zencierge Host Command Center.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell
      title="Welcome Back"
      subtitle="Sign in to access your Host Command Center."
    >
      <HostAuthForm mode="login" nextPath={next || "/dashboard"} />
    </AuthShell>
  );
}
