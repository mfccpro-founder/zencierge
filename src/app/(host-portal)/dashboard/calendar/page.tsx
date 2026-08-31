import { DashboardApp } from "@/components/dashboard/dashboard-app";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calendar · Zencierge",
  description: "Reservations and turnover windows for Florida listings.",
};

export default function DashboardCalendarPage() {
  return <DashboardApp initialTab="calendar" />;
}
