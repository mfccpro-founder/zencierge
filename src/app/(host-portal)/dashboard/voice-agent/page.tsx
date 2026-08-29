import { DashboardApp } from "@/components/dashboard/dashboard-app";
import { ListingsProvider } from "@/components/dashboard/listings-provider";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Voice Concierge · Zencierge",
};

export default function DashboardVoiceAgentPage() {
  return (
    <ListingsProvider>
      <DashboardApp initialTab="voice" />
    </ListingsProvider>
  );
}
