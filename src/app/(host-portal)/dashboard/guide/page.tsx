import type { Metadata } from "next";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostUserGuide } from "@/components/dashboard/host-user-guide";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";
import { hostGuideModuleCount } from "@/lib/host-guide-content";

export const metadata: Metadata = {
  title: "User Guide & Docs · Zencierge",
  description: "Host knowledge base for Properties, Elena, Housekeeping, Guest DNA, NeighborShield, Dispute Dossier, Financials, Voice Concierge, and Settings.",
};

export default function HostGuidePage() {
  const moduleCount = hostGuideModuleCount();
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="User Guide & Knowledge Base"
        subtitle={`${moduleCount} modules. Available in English and Spanish.`}
      />
      <HostUserGuide />
    </HostOpsPage>
  );
}
