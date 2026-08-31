import { DashboardApp } from "@/components/dashboard/dashboard-app";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings · Zencierge",
  description: "Host profile, billing, alert rules, smart locks, OTA sync, and team access.",
};

export default function DashboardSettingsPage() {
  return <DashboardApp initialTab="settings" />;
}
