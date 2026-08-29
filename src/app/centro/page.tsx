import type { Metadata } from "next";
import { CentroFinanceDashboard } from "@/components/finance/centro-finance-dashboard";

export const metadata: Metadata = {
  title: "Mi Centro Financiero",
  description: "Daily briefing, credit utilization, cash flow, and upcoming bills.",
};

export default function CentroDashboardPage() {
  return <CentroFinanceDashboard />;
}
