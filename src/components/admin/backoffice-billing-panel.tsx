import Link from "next/link";
import type {
  AdminBillingPlanSummary,
  AdminBillingSnapshot,
  AdminSubscriberRow,
} from "@/lib/admin-billing";
import { formatBillingUsd, formatDate } from "@/lib/admin-billing";
import { backOfficeCustomerStatusLabel } from "@/lib/backoffice-customers";
import { complimentaryDaysRemaining } from "@/lib/complimentary-access-core";
import { trialDaysRemaining } from "@/lib/zencierge-plans";

type Props = {
  customers: AdminSubscriberRow[];
  metrics: AdminBillingSnapshot["metrics"];
  plans: AdminBillingPlanSummary[];
  generatedAt: string;
};

const STATUS_CLASS: Record<string, string> = {
  Paying: "border-emerald-800 bg-emerald-700 text-white",
  Complimentary: "border-violet-800 bg-violet-700 text-white",
  "Lifetime VIP": "border-amber-800 bg-amber-600 text-white",
  "14-Day Trial": "border-sky-800 bg-sky-700 text-white",
  "Past Due": "border-rose-800 bg-rose-700 text-white",
  Canceled: "border-slate-800 bg-slate-700 text-white",
  "No Subscription": "border-amber-800 bg-amber-600 text-white",
};

function accessDetail(row: AdminSubscriberRow) {
  if (row.trialActive && row.trialEndsAt) {
    const days = trialDaysRemaining(row.trialEndsAt);
    return `${days} trial day${days === 1 ? "" : "s"} remaining`;
  }
  if (row.complimentaryActive && row.complimentaryEndsAt) {
    const days = complimentaryDaysRemaining(row.complimentaryEndsAt);
    return `${days} complimentary day${days === 1 ? "" : "s"} remaining`;
  }
  return null;
}

export function BackOfficeBillingPanel({ customers, metrics, plans, generatedAt }: Props) {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Billing totals">
        <Kpi label="Paying MRR" value={formatBillingUsd(metrics.mrr)} detail={`${metrics.alDia} paying subscribers`} />
        <Kpi label="Past due" value={metrics.morosos.toLocaleString("en-US")} detail="Square/local status requiring review" />
        <Kpi label="Failed payments" value={metrics.failedPayments30d.toLocaleString("en-US")} detail="Last 30 days" />
        <Kpi
          label="Special access"
          value={(metrics.trials + metrics.complimentary).toLocaleString("en-US")}
          detail={`${metrics.trials} trial · ${metrics.complimentary} complimentary`}
        />
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-bold text-slate-900">Subscribers and MRR by plan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Account count includes assigned non-paying access. MRR includes paid, current subscriptions only.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((row) => (
            <article key={row.planId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{row.planName}</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatBillingUsd(row.mrrUsd)} MRR</p>
              <p className="mt-1 text-sm text-slate-600">
                {row.payingCount} paying · {row.accountCount} assigned accounts
              </p>
              <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-sm text-slate-700">
                <PlanLine label="Catalog rate" value={`${formatBillingUsd(row.catalogMonthlyUsd)}/mo`} />
                <PlanLine label="Trials" value={String(row.trialCount)} />
                <PlanLine label="Complimentary" value={String(row.complimentaryCount)} />
                <PlanLine label="Past due" value={String(row.pastDueCount)} />
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Subscription detail</h2>
          <p className="mt-1 text-sm text-slate-600">
            Live status and stored Square identifiers. Open a customer to manage existing complimentary access.
          </p>
        </div>

        {customers.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center">
            <p className="font-semibold text-slate-900">No billing accounts loaded</p>
            <p className="mt-1 text-sm text-slate-600">No demo subscribers are injected.</p>
          </div>
        ) : (
          <div className="mt-5 max-h-[680px] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100/95 text-xs uppercase tracking-wide text-slate-700 backdrop-blur-sm">
                <tr>
                  <th className="border-b border-slate-300 px-4 py-3">Customer</th>
                  <th className="border-b border-slate-300 px-4 py-3">Plan</th>
                  <th className="border-b border-slate-300 px-4 py-3">Access</th>
                  <th className="border-b border-slate-300 px-4 py-3">Next charge</th>
                  <th className="border-b border-slate-300 px-4 py-3">Payment signal</th>
                  <th className="border-b border-slate-300 px-4 py-3">Square subscription ID</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((row) => {
                  const status = backOfficeCustomerStatusLabel(row);
                  const detail = accessDetail(row);
                  const lastFailed = row.failedPayments[0];
                  return (
                    <tr key={row.userId} className="align-top hover:bg-slate-50">
                      <td className="border-b border-slate-200 px-4 py-3">
                        <Link
                          href={`/backoffice/customers/${row.userId}`}
                          className="font-semibold text-emerald-800 hover:underline"
                        >
                          {row.fullName ?? row.email}
                        </Link>
                        {row.fullName ? <p className="mt-1 text-xs text-slate-600">{row.email}</p> : null}
                      </td>
                      <td className="border-b border-slate-200 px-4 py-3">
                        <p className="font-medium text-slate-900">{row.planName}</p>
                        <p className="mt-1 text-xs text-slate-600">{formatBillingUsd(row.monthlyUsd)}/mo catalog</p>
                      </td>
                      <td className="border-b border-slate-200 px-4 py-3">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_CLASS[status] ?? STATUS_CLASS["No Subscription"]}`}
                        >
                          {status}
                        </span>
                        {detail ? <p className="mt-1.5 text-xs text-slate-600">{detail}</p> : null}
                      </td>
                      <td className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-slate-800">
                        {formatDate(row.nextChargeAt)}
                      </td>
                      <td className="border-b border-slate-200 px-4 py-3">
                        {lastFailed ? (
                          <div className="text-rose-800">
                            <p className="font-semibold">Failed · {formatDate(lastFailed.at)}</p>
                            <p className="mt-1 text-xs">
                              {lastFailed.amountUsd > 0 ? formatBillingUsd(lastFailed.amountUsd) : "Amount unavailable"}
                            </p>
                          </div>
                        ) : row.paymentState === "moroso" ? (
                          <span className="font-semibold text-rose-800">Past due</span>
                        ) : (
                          <span className="text-slate-600">No failed payment loaded</span>
                        )}
                      </td>
                      <td className="border-b border-slate-200 px-4 py-3 font-mono text-xs text-slate-700">
                        {row.squareSubscriptionId ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Snapshot generated {new Date(generatedAt).toLocaleString("en-US")}. Read-only: no cancel, pause, resume,
        retry, or charge controls are available in this phase.
      </p>
    </div>
  );
}

function Kpi(input: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{input.label}</p>
      <p className="mt-2 text-3xl font-extrabold text-slate-900">{input.value}</p>
      <p className="mt-1 text-sm text-slate-600">{input.detail}</p>
    </div>
  );
}

function PlanLine(input: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{input.label}</dt>
      <dd className="font-semibold text-slate-900">{input.value}</dd>
    </div>
  );
}