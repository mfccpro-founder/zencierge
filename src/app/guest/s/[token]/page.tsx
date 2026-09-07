import { GuestStayShell } from "@/components/guest/guest-stay-shell";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your stay · Guest portal",
  description: "Secure guest stay access.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SecureGuestStayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <GuestStayShell key={token} token={token} />;
}
