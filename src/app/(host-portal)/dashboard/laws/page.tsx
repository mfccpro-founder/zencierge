import type { Metadata } from "next";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";
import { LawsRegulationsView } from "@/components/dashboard/laws-regulations-view";

export const metadata: Metadata = {
  title: "Airbnb Regulations & Laws · Zencierge",
  description: "Location-specific zoning, lodging-tax, and platform-compliance guidance for each property.",
};

export default function HostLawsPage() {
  return (
    <HostOpsPage>
      <LawsRegulationsView />
    </HostOpsPage>
  );
}
