import { DashboardApp } from "@/components/dashboard/dashboard-app";
import { ListingsProvider } from "@/components/dashboard/listings-provider";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Financials · Zencierge",
  description: "Net profit, ADR, occupancy, and payouts for Florida Airbnb and Vrbo listings.",
};

export default function FinancialsPage() {
  return (
    <ListingsProvider>
      <DashboardApp initialTab="finances" />
    </ListingsProvider>
  );
}
