import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  formatProfitMarginPercent,
  formatProfitUsd,
  getAdminProfitSnapshot,
} from "@/lib/admin-profit";

export const metadata: Metadata = {
  title: "Profit · Zencierge Founder Back Office",
  description: "Net operating profit from live collected income, payroll, OpEx, and Isabela AI COGS.",
};

export const dynamic = "force-dynamic";

export default async function BackOfficeProfitPage() {
  const snapshot = await getAdminProfitSnapshot();
  const profitValueLabel = snapshot.profitIsPartial
    ? `${formatProfitUsd(snapshot.netOperatingProfitUsd)} · Partial`
    : formatProfitUsd(snapshot.netOperatingProfitUsd);
  const marginValueLabel = snapshot.profitIsPartial
    ? `${formatProfitMarginPercent(snapshot.operatingMarginPercent)} · Partial`
    : formatProfitMarginPercent(snapshot.operatingMarginPercent);
  const aiValueLabel = snapshot.profitIsPartial
    ? snapshot.isabelaExactAiCostLabel === "—"
      ? "— · Partial"
      : `${snapshot.isabelaExactAiCostLabel} · Partial`
    : snapshot.isabelaExactAiCostLabel;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Profit</h1>
        <p className="mt-1 text-lg text-slate-700">
          Net operating profit · {snapshot.monthLabel} · {snapshot.timeZone}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Collected Income − Payroll − Contractors − Other OpEx − Isabela exact AI COGS. MRR is shown for SaaS
          context only and is never used as cash. No demo revenue or invented expenses.
        </p>
      </div>

      {snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error}
        </div>
      ) : null}

      {snapshot.profitPartialNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.profitPartialNote}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Collected Income This Month"
          value={formatProfitUsd(snapshot.collectedThisMonthUsd)}
          detail="Succeeded subscription payments only"
        />
        <Kpi label="MRR" value={formatProfitUsd(snapshot.mrrUsd)} detail={snapshot.mrrNote} />
        <Kpi
          label="Payroll"
          value={formatProfitUsd(snapshot.payrollThisMonthUsd)}
          detail="business_expenses · payroll"
        />
        <Kpi
          label="Contractors"
          value={formatProfitUsd(snapshot.contractorsThisMonthUsd)}
          detail="Counted once in total operating costs"
        />
        <Kpi
          label="Other Operating Expenses"
          value={formatProfitUsd(snapshot.otherOperatingThisMonthUsd)}
          detail="Manual ledger excluding payroll & contractors"
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Isabela AI Costs</p>
          <p className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">{aiValueLabel}</p>
          <p className="mt-2 text-sm text-slate-700">Exact tracked from Isabela Usage · not from expense ledger</p>
          <Link href="/backoffice/isabela-usage" className="mt-2 inline-block text-xs font-semibold underline">
            Open Isabela Usage
          </Link>
        </div>
        <Kpi
          label="Total Operating Costs"
          value={formatProfitUsd(snapshot.totalOperatingCostsUsd)}
          detail="Payroll + contractors + other OpEx + exact AI"
        />
        <Kpi
          label="Net Operating Profit"
          value={profitValueLabel}
          detail={
            snapshot.profitIsPartial
              ? "Partial · pending full AI pricing"
              : `Exactness: ${snapshot.profitExactnessLabel}`
          }
        />
        <Kpi
          label="Operating Margin %"
          value={marginValueLabel}
          detail={
            snapshot.collectedThisMonthUsd > 0
              ? "Net profit ÷ collected income"
              : "No collected income this month"
          }
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Monthly breakdown</h2>
        <p className="mt-1 text-xs text-slate-500">{snapshot.monthLabel}</p>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
          <BreakdownBlock title="Revenue">
            <Line
              label="Subscription payments collected"
              value={formatProfitUsd(snapshot.collectedThisMonthUsd)}
            />
            <Line label="MRR (run-rate only · not in profit)" value={formatProfitUsd(snapshot.mrrUsd)} muted />
          </BreakdownBlock>

          <BreakdownBlock title="Costs">
            <Line label="Payroll" value={formatProfitUsd(snapshot.payrollThisMonthUsd)} />
            <Line label="Contractors" value={formatProfitUsd(snapshot.contractorsThisMonthUsd)} />
            {snapshot.otherOpexLines.length === 0 ? (
              <Line label="Other operating (hosting/software/…)" value={formatProfitUsd(0)} />
            ) : (
              snapshot.otherOpexLines.map((line) => (
                <Line key={line.category} label={line.label} value={formatProfitUsd(line.amountUsd)} />
              ))
            )}
            <Line
              label={
                snapshot.profitIsPartial
                  ? "Isabela AI COGS (exact tracked · partial)"
                  : "Isabela AI COGS"
              }
              value={
                snapshot.isabelaExactAiCostUsd == null
                  ? snapshot.isabelaExactAiCostLabel
                  : formatProfitUsd(snapshot.isabelaAiCostUsedUsd)
              }
            />
            <Line label="Total operating costs" value={formatProfitUsd(snapshot.totalOperatingCostsUsd)} strong />
          </BreakdownBlock>

          <BreakdownBlock title="Result">
            <Line
              label={
                snapshot.profitIsPartial
                  ? "Net Operating Profit (Partial)"
                  : "Net Operating Profit"
              }
              value={formatProfitUsd(snapshot.netOperatingProfitUsd)}
              strong
            />
            <Line label="Operating margin" value={marginValueLabel} />
          </BreakdownBlock>
        </div>
      </section>
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

function BreakdownBlock(input: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">{input.title}</h3>
      <ul className="mt-3 space-y-2">{input.children}</ul>
    </div>
  );
}

function Line(input: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <li
      className={`flex items-baseline justify-between gap-3 text-sm ${
        input.muted ? "text-slate-500" : "text-slate-800"
      } ${input.strong ? "border-t border-slate-200 pt-2 font-semibold" : ""}`}
    >
      <span>{input.label}</span>
      <span className="tabular-nums">{input.value}</span>
    </li>
  );
}
