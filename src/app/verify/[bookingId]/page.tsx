import { GuestVerifyWizard } from "@/components/guest/guest-verify-wizard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Guest verification · Zencierge",
  description: "Verify your identity, authorize the security hold, and sign house rules before check-in.",
};

export default async function GuestVerifyPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <GuestVerifyWizard bookingId={bookingId} />;
}
