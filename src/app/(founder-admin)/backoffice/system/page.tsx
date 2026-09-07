import type { Metadata } from "next";
import {
  BackOfficeSystemHealthDesktop,
  BackOfficeSystemHealthMobile,
} from "@/components/admin/backoffice-system-health-view";
import { getSystemHealthAlertSummary } from "@/lib/admin-system-health-alerts";
import { getAdminSystemHealthSnapshot } from "@/lib/admin-system-health";

export const metadata: Metadata = {
  title: "System · Zencierge Founder Back Office",
  description: "Read-only Founder System Health for Zencierge operational services.",
};

export const dynamic = "force-dynamic";

function formatAlertWhen(iso: string | null) {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function BackOfficeSystemPage() {
  const [snapshot, alertSummary] = await Promise.all([
    getAdminSystemHealthSnapshot(),
    getSystemHealthAlertSummary(),
  ]);

  return (
    <div className="space-y-2 md:space-y-4">
      <div>
        <h1 className="text-lg font-bold tracking-tight text-slate-900 md:text-2xl">System</h1>
        <p className="mt-1 hidden text-sm text-slate-600 md:block">
          Founder ops panel · read-only · click a service for full detail
        </p>
      </div>

      {snapshot.error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-950">
          {snapshot.error}
        </div>
      ) : null}

      <p className="text-[10px] leading-snug text-slate-500 md:text-xs">
        Founder alerts · scheduler {alertSummary.schedulerEnabled ? "ON" : "OFF"} · open{" "}
        {alertSummary.openIncidents} · last eval {formatAlertWhen(alertSummary.lastEvaluatedAt)} ·
        last sent {formatAlertWhen(alertSummary.lastAlertedAt)}
        {alertSummary.lastAlertKind ? ` (${alertSummary.lastAlertKind})` : ""}
        {alertSummary.error ? ` · ${alertSummary.error}` : ""}
      </p>

      <BackOfficeSystemHealthMobile
        header={snapshot.header}
        generatedAt={snapshot.generatedAt}
        services={snapshot.services}
      />

      <BackOfficeSystemHealthDesktop
        header={snapshot.header}
        generatedAt={snapshot.generatedAt}
        timeZone={snapshot.timeZone}
        services={snapshot.services}
      />
    </div>
  );
}
