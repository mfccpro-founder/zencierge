import type { Metadata } from "next";
import {
  formatIncomeUsd,
  getAdminIncomeSnapshot,
  type IncomePaymentStatus,
} from "@/lib/admin-income";
import { IncomeTransactionFilter } from "@/components/admin/income-transaction-filter";

export const metadata: Metadata = {
  title: "Income · Zencierge Founder Back Office",
  description: "Live Zencierge subscription cash collected and MRR run-rate.",
};

export const dynamic = "force-dynamic";

function parseFilter(value: string | string[] | undefined): "succeeded" | "failed" | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "failed" || raw === "all") return raw;
  return "succeeded";
}

function statusLabel(status: IncomePaymentStatus) {
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "refunded") return "Refunded";
  return "Other";
}

export default async function BackOfficeIncomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const transactionFilter = parseFilter(params.status);
  const snapshot = await getAdminIncomeSnapshot({ transactionFilter });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Income</h1>
        <p className="mt-1 text-lg text-slate-700">
          Zencierge company subscription income · {snapshot.monthLabel} · {snapshot.timeZone}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Collected revenue comes from live <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">subscription_payments</code>.
          MRR is a separate run-rate from paying subscriptions — not cash collected. No demo revenue.
        </p>
      </div>

      {snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Collected this month"
          value={formatIncomeUsd(snapshot.collectedThisMonthUsd)}
          detail={`Succeeded payments · ${snapshot.monthLabel}`}
        />
        <Kpi
          label="Collected YTD"
          value={formatIncomeUsd(snapshot.collectedYtdUsd)}
          detail={`Succeeded payments · ${snapshot.ytdLabel}`}
        />
        <Kpi
          label="MRR"
          value={formatIncomeUsd(snapshot.mrrUsd)}
          detail={snapshot.mrrNote}
        />
        <Kpi
          label="Successful payments"
          value={snapshot.successfulPaymentsThisMonth.toLocaleString("en-US")}
          detail="This month · succeeded only"
        />
        <Kpi
          label="Failed payments"
          value={snapshot.failedPaymentsThisMonth.toLocaleString("en-US")}
          detail="This month · excluded from collected revenue"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Revenue by plan (YTD)</h2>
          <p className="mt-1 text-xs text-slate-500">Succeeded payments only</p>
          {snapshot.revenueByPlan.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No succeeded payments YTD yet.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm text-slate-800">
              {snapshot.revenueByPlan.map((row) => (
                <li
                  key={row.planId}
                  className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2"
                >
                  <span className="font-semibold">{row.planName}</span>
                  <span className="text-slate-600">
                    {formatIncomeUsd(row.amountUsd)} · {row.paymentCount} payments
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Monthly collected trend</h2>
          <p className="mt-1 text-xs text-slate-500">Last {snapshot.monthlyTrend.length} months · succeeded only</p>
          {snapshot.monthlyTrend.every((row) => row.collectedUsd === 0) ? (
            <p className="mt-3 text-sm text-slate-600">No succeeded payments in this window yet.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm text-slate-800">
              {snapshot.monthlyTrend.map((row) => (
                <li
                  key={`${row.year}-${row.month}`}
                  className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2"
                >
                  <span className="font-semibold">{row.label}</span>
                  <span className="text-slate-600">
                    {formatIncomeUsd(row.collectedUsd)} · {row.succeededCount} payments
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Transactions</h2>
            <p className="mt-1 text-xs text-slate-500">
              Live <code className="rounded bg-slate-100 px-1">subscription_payments</code> · Square id when present ·
              no card data
            </p>
          </div>
          <IncomeTransactionFilter current={transactionFilter} />
        </div>

        {snapshot.transactions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No {transactionFilter} payments in the loaded window.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Plan</th>
                  <th className="px-3 py-2 font-semibold">Amount</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Square reference</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.transactions.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 text-slate-800">
                    <td className="whitespace-nowrap px-3 py-2">{row.dateLabel}</td>
                    <td className="px-3 py-2">
                      {row.customerLabel}
                      {!row.customerLinked ? (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                          Unlinked
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{row.planLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatIncomeUsd(row.amountUsd)}</td>
                    <td className="px-3 py-2">{statusLabel(row.status)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {row.providerPaymentId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Month UTC window: {snapshot.rangeMonthStartUtc} → {snapshot.rangeMonthEndUtc}. Refund UI is deferred until
        refund writes exist.
      </p>
    </div>
  );
}

function Kpi(input: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">{input.label}</p>
      <p className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">{input.value}</p>
      <p className="mt-2 text-sm text-slate-700">{input.detail}</p>
    </div>
  );
}
