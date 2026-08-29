import type { Metadata } from "next";
import { HousekeepingPanel } from "@/components/dashboard/housekeeping-panel";
import { HousekeepingStaffLinkCard } from "@/components/dashboard/housekeeping-staff-link-card";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";

export const metadata: Metadata = {
  title: "Housekeeping / Inspections · Zencierge",
};

export default function HostHousekeepingPage() {
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="Housekeeping / Inspections"
        subtitle="Inspection photos per listing, plus a public camera link for your cleaning team."
      />
      <HousekeepingStaffLinkCard />
      <HousekeepingPanel />
    </HostOpsPage>
  );
}
