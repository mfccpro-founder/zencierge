import { GuestStayShell } from "@/components/guest/guest-stay-shell";
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
  // Legacy booking IDs are no longer authorization. Only a valid guest-stay
  // token can resolve stay metadata or secrets through the server endpoints.
  return <GuestStayShell token={bookingId} />;
}
