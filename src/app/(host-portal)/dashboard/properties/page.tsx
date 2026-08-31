import { DashboardApp } from "@/components/dashboard/dashboard-app";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Properties · Zencierge",
};

export default function DashboardPropertiesPage() {
  return <DashboardApp initialTab="properties" />;
}
