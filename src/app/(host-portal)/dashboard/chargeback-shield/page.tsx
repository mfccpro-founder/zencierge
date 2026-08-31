import type { Metadata } from "next";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";
import { ChargebackShieldView } from "@/components/dashboard/chargeback-shield-view";

export const metadata: Metadata = {
  title: "Chargeback Shield · Zencierge",
  description:
    "Auto-generated dispute dossiers per reservation: signatures, lock logs, Elena communications, and housekeeping proofs.",
};

export default function ChargebackShieldPage() {
  return (
    <HostOpsPage>
      <ChargebackShieldView />
    </HostOpsPage>
  );
}
