import { GuestPortal } from "@/components/guest/guest-portal";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Guest Portal · Zencierge",
  description: "Your stay concierge — Wi-Fi, check-in, and a bilingual AI receptionist.",
};

export default async function GuestStayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GuestPortal propertyId={id} />;
}
