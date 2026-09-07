import { LegacyGuestLink } from "@/components/guest/legacy-guest-link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guest portal",
  description: "This guest link is no longer valid.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function LegacyGuestStayPage() {
  return <LegacyGuestLink />;
}
