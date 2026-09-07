import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, TriangleAlert, Users, XCircle } from "lucide-react";
import { formatDate, getAdminBillingSnapshot } from "@/lib/admin-billing";
import { getAiUsageMonthSnapshot } from "@/lib/ai-usage";
import {
  formatSystemHealthStatus,
  getAdminSystemHealthSnapshot,
  summarizeSystemHealthForOverview,
} from "@/lib/admin-system-health";

export const metadata: Metadata = {
  title: "Overview · Zencierge Founder Back Office",
  description: "Live Founder overview of paying hosts, MRR, and payment health.",
};

export const dynamic = "force-dynamic";

export default async function BackOfficeOverviewPage() {
  const [snapshot, usage, systemHealth] = await Promise.all([
    getAdminBillingSnapshot(),
    getAiUsageMonthSnapshot(),
    getAdminSystemHealthSnapshot(),
  ]);
  const { metrics } = snapshot;
  const systemSummary = summarizeSystemHealthForOverview(systemHealth);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Overview</h1>
        <p className="mt-1 text-lg text-slate-700">
          Live billing snapshot · {formatDate(snapshot.generatedAt)}{" "}
          {new Date(snapshot.generatedAt).toLocaleTimeString("en-US")}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Source: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">getAdminBillingSnapshot()</code>{" "}
          — not demo Revenue.
        </p>
      </div>

      {!snapshot.serviceRoleReady || snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error ??
            "SUPABASE_SERVICE_ROLE_KEY is not configured. The Back Office needs it to read all subscriptions."}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Paying customers</p>
            <Users className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.alDia}</p>
          <p className="mt-2 text-sm text-slate-700">Active subscriptions in good standing</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Past-due customers</p>
            <TriangleAlert className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.morosos}</p>
          <p className="mt-2 text-sm text-slate-700">Past due or overdue billing period</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Canceled customers</p>
            <XCircle className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.cancelados}</p>
          <p className="mt-2 text-sm text-slate-700">Canceled subscription status</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">14-Day Trials</p>
            <Users className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.trials}</p>
          <p className="mt-2 text-sm text-slate-700">Active public trials (excluded from MRR)</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Complimentary</p>
            <Users className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.complimentary}</p>
          <p className="mt-2 text-sm text-slate-700">Active complimentary windows (excluded from MRR)</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">MRR</p>
            <CreditCard className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">
            ${metrics.mrr.toLocaleString("en-US")}
          </p>
          <p className="mt-2 text-sm text-slate-700">Catalog monthly USD from paying hosts only</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Failed payments · 30d</p>
            <TriangleAlert className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.failedPayments30d}</p>
          <p className="mt-2 text-sm text-slate-700">Failed / declined charges in the last 30 days</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Isabela Usage</h2>
          {usage.error ? (
            <p className="mt-2 text-sm text-amber-900">{usage.error}</p>
          ) : (
            <>
              <p className="mt-2 text-3xl font-extrabold text-slate-900">
                {usage.ttsSuccessful.toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Successful TTS · {usage.monthLabel} ({usage.timeZone})
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {usage.charactersSynthesized.toLocaleString("en-US")} characters · Exact cost:{" "}
                {usage.exactTrackedCostLabel}
                {usage.totalsArePartial ? " · totals partial (OpenAI pending)" : ""}
              </p>
            </>
          )}
          <Link
            href="/backoffice/isabela-usage"
            className="mt-3 inline-block text-sm font-semibold text-slate-800 underline"
          >
            Open Isabela Usage
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">System</h2>
          <p className="mt-2 text-3xl font-extrabold text-slate-900">{systemSummary.headline}</p>
          <p className="mt-2 text-sm text-slate-700">
            Overall: {formatSystemHealthStatus(systemSummary.statusTone)} ·{" "}
            {systemHealth.header.healthyCount} healthy · {systemHealth.header.degradedCount} degraded ·{" "}
            {systemHealth.header.downCount} down · {systemHealth.header.unknownCount} unknown
          </p>
          <p className="mt-1 text-xs text-slate-500">Read-only passive health · no emergency controls</p>
          <Link
            href="/backoffice/system"
            className="mt-3 inline-block text-sm font-semibold text-slate-800 underline"
          >
            Open System Health
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
        <p className="font-semibold text-slate-900">Also available</p>
        <p className="mt-1">
          Existing Founder tools remain at{" "}
          <Link href="/admin" className="font-semibold text-emerald-700 hover:underline">
            /admin
          </Link>{" "}
          (Hosts, Feature Requests). Demo Revenue store is not used here.
        </p>
      </div>
    </div>
  );
}
