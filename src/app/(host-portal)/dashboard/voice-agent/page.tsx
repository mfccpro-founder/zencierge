import type { Metadata } from "next";
import { VoiceConciergeView } from "@/components/dashboard/voice-concierge-view";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";

export const metadata: Metadata = {
  title: "Voice Concierge · Elena · Zencierge",
  description: "Elena AI receptionist, live talk controls, and guest QR cards.",
};

export const dynamic = "force-dynamic";

export default function DashboardVoiceAgentPage() {
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="Elena Voice Concierge"
        subtitle="Live talk controls, Florida line, and guest QR cards."
      />
      <VoiceConciergeView />
    </HostOpsPage>
  );
}
