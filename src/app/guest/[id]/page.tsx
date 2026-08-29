import { GuestPortal } from "@/components/guest/guest-portal";
import { guestStayFallback } from "@/lib/dashboard-data";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your stay · Elena AI Concierge",
  description: "Wi-Fi, door code, check-in hours, and a 24/7 voice concierge for this listing.",
};

export default async function GuestStayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GuestPortal propertyId={id} initialProperty={guestStayFallback(id)} />;
}
