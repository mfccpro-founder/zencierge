import type { Metadata } from "next";
import { HostOpsPage } from "@/components/dashboard/host-ops-page";
import { LawsRegulationsView } from "@/components/dashboard/laws-regulations-view";

export const metadata: Metadata = {
  title: "Leyes y regulaciones de Airbnb · Zencierge",
  description:
    "Guía de zonificación, impuestos turísticos y cumplimiento de plataformas según la ubicación de cada propiedad en Florida.",
};

export default function HostLawsPage() {
  return (
    <HostOpsPage>
      <LawsRegulationsView />
    </HostOpsPage>
  );
}
