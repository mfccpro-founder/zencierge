import type { Metadata } from "next";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostUserGuide } from "@/components/dashboard/host-user-guide";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";

export const metadata: Metadata = {
  title: "User Guide & Docs · Zencierge",
  description: "Host knowledge base for Properties, Elena, Housekeeping, Guest DNA, NeighborShield, Dispute Dossier, Financials, Voice Concierge, and Settings.",
};

export default function HostGuidePage() {
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="User Guide & Knowledge Base"
        subtitle="Eight modules. English only. Search, jump from the table of contents, then open the live tool."
      />
      <HostUserGuide />
    </HostOpsPage>
  );
}
