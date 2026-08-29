import type { Metadata } from "next";
import { GuestDnaPanel } from "@/components/admin/guest-dna-panel";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";

export const metadata: Metadata = {
  title: "Guest DNA & Direct Leads · Zencierge",
};

export default function HostGuestDnaPage() {
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="Guest DNA & Direct Leads"
        subtitle="Guests captured at the check-in gate, with chargeback and false-dispute tags — your direct booking pipeline."
      />
      <GuestDnaPanel />
    </HostOpsPage>
  );
}
