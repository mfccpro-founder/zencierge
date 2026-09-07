import { HousekeepingProofShell } from "@/components/housekeeping/housekeeping-proof-shell";
import type { Metadata, Viewport } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Housekeeping Proof",
  description: "Secure housekeeping task access.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function HousekeepingProofPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <HousekeepingProofShell token={token} />;
}
