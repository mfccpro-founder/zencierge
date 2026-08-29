import type { Metadata } from "next";
import { DisputeDossierPanel } from "@/components/admin/dispute-dossier-panel";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";

export const metadata: Metadata = {
  title: "Dispute Dossier · Zencierge",
};

export default function HostDisputeDossierPage() {
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="Dispute Dossier"
        subtitle="Forensic evidence packs for AirCover and OTA support — chain of custody, timestamps, and a printable claim exhibit."
      />
      <DisputeDossierPanel />
    </HostOpsPage>
  );
}
