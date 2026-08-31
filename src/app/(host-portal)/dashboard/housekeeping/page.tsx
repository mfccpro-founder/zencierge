import type { Metadata } from "next";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";
import { HousekeepingOpsView } from "@/components/dashboard/housekeeping-ops-view";

export const metadata: Metadata = {
  title: "Housekeeping · Zencierge",
};

export default function HostHousekeepingPage() {
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="Housekeeping & staff"
        subtitle="Inspections, consumable stock, cleaner upload access, and team invites — one operations hub."
      />
      <HousekeepingOpsView />
    </HostOpsPage>
  );
}
