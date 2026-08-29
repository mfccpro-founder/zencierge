import { DashboardApp } from "@/components/dashboard/dashboard-app";
import { ListingsProvider } from "@/components/dashboard/listings-provider";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Properties · Zencierge",
};

export default function DashboardPropertiesPage() {
  return (
    <ListingsProvider>
      <DashboardApp initialTab="properties" />
    </ListingsProvider>
  );
}
