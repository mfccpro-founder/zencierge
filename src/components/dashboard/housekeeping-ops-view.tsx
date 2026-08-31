"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HousekeepingPanel } from "@/components/dashboard/housekeeping-panel";
import { HousekeepingReportsHistory } from "@/components/dashboard/housekeeping-reports-history";
import { SupplyTrackingView } from "@/components/dashboard/supply-tracking-view";
import { TeamCleanersAccessPanel } from "@/components/dashboard/team-cleaners-access";

const TABS = [
  { id: "inspections", href: "/dashboard/housekeeping", label: "Inspections" },
  { id: "reports", href: "/dashboard/housekeeping?tab=reports", label: "Photo reports" },
  { id: "supplies", href: "/dashboard/housekeeping?tab=supplies", label: "Supplies" },
  { id: "team", href: "/dashboard/housekeeping?tab=team", label: "Team & Cleaners Access" },
] as const;

function HousekeepingOpsInner() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const active = tab === "supplies" || tab === "team" || tab === "reports" ? tab : "inspections";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => {
          const current = item.id === active;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                current
                  ? "border-sky-600 bg-sky-600 text-white"
                  : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      {active === "supplies" ? <SupplyTrackingView /> : null}
      {active === "team" ? <TeamCleanersAccessPanel /> : null}
      {active === "reports" ? <HousekeepingReportsHistory /> : null}
      {active === "inspections" ? <HousekeepingPanel /> : null}
    </div>
  );
}

export function HousekeepingOpsView() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading operations…</p>}>
      <HousekeepingOpsInner />
    </Suspense>
  );
}
