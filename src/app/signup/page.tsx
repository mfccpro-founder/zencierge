import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { HostAuthForm } from "@/components/auth/host-auth-form";
import { parsePlanId } from "@/lib/zencierge-plans";

export const metadata: Metadata = {
  title: "Create your host account · Zencierge",
  description: "Create a host account, complete Square checkout, and start the Host Command Center.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const initialPlan = parsePlanId(plan) ?? "pro";

  return (
    <AuthShell
      size="wide"
      title="Create your host account"
      subtitle="Create your account, then complete Square Sandbox checkout to activate your plan."
    >
      <HostAuthForm mode="signup" initialPlan={initialPlan} />
    </AuthShell>
  );
}
