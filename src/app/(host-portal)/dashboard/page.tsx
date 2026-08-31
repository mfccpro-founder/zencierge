import { DashboardApp } from "@/components/dashboard/dashboard-app";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zencierge · Host Command Center",
  description:
    "Calendar, finances, and AI voice concierge for Airbnb and Vrbo hosts in Florida.",
};

export default function DashboardPage() {
  return <DashboardApp />;
}
