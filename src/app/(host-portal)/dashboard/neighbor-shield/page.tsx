import type { Metadata } from "next";
import { NeighborShieldPanel } from "@/components/admin/neighbor-shield-panel";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";

export const metadata: Metadata = {
  title: "NeighborShield · Zencierge",
};

export default function HostNeighborShieldPage() {
  return (
    <HostOpsPage>
      <HostHeroBanner
        title="NeighborShield"
        subtitle="Community complaints for noise, parking, and trash — with a one-click house-rules notice to the in-stay guest."
      />
      <NeighborShieldPanel />
    </HostOpsPage>
  );
}
