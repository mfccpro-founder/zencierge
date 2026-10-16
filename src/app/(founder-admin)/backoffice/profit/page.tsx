import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { OpenAiReconciledSpendCard } from "@/components/admin/openai-reconciled-spend-card";
import {
  formatProfitUsd,
  getAdminProfitSnapshot,
  presentIsabelaAiCost,
  presentOperatingMargin,
  presentOperatingResult,
  presentProfitAmount,
  PROFIT_PENDING_AI_EXPLANATION,
  PROFIT_UNAVAILABLE_LABEL,
} from "@/lib/admin-profit";
import { readOpenAiBackOfficeCosts } from "@/lib/openai-costs-read";

export const metadata: Metadata = {
  title: "Profit · Zencierge Founder Back Office",
  description: "Net operating profit from live collected income, payroll, OpEx, and Isabela AI COGS.",
};

export const dynamic = "force-dynamic";

export default async function BackOfficeProfitPage() {
  const [snapshot, reconciliation] = await Promise.all([
    getAdminProfitSnapshot(),
    readOpenAiBackOfficeCosts(),
  ]);
  const sourcesUnavailable =
    snapshot.collectedThisMonthUsd == null ||
    snapshot.payrollThisMonthUsd == null ||
    snapshot.contractorsThisMonthUsd == null ||
    snapshot.otherOperatingThisMonthUsd == null ||
    snapshot.isabelaReadUnavailable;
  const knownAmount = (amount: number | null) =>
    presentProfitAmount({ unavailable: amount == null, partial: false, amount });
  const operatingResult = presentOperatingResult({
    unavailable: sourcesUnavailable,
    pricingPartial: snapshot.isabelaAiPricingPartial,
    readIncomplete: snapshot.isabelaReadIncomplete,
    amount: snapshot.netOperatingProfitUsd,
  });
  const operatingMargin = presentOperatingMargin({
    unavailable: sourcesUnavailable,
    pricingPartial: snapshot.isabelaAiPricingPartial,
    readIncomplete: snapshot.isabelaReadIncomplete,
    margin: snapshot.operatingMarginPercent,
  });
  const totalCostsLabel = presentProfitAmount({
    unavailable: snapshot.totalOperatingCostsUsd == null,
    partial: snapshot.isabelaAiPricingPartial && snapshot.totalOperatingCostsUsd != null,
    amount: snapshot.totalOperatingCostsUsd,
  });
  const aiValueLabel = presentIsabelaAiCost({
    readUnavailable: snapshot.isabelaReadUnavailable,
    pricingPartial: snapshot.isabelaAiPricingPartial,
    profitPartial: snapshot.profitIsPartial,
    exactAiCostUsd: snapshot.isabelaExactAiCostUsd,
    exactAiCostLabel: snapshot.isabelaExactAiCostLabel,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Profit</h1>
        <p className="mt-1 text-lg text-slate-700">
          Net operating profit · {snapshot.monthLabel} · {snapshot.timeZone}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Collected Income − Payroll − Contractors − Other OpEx − Isabela estimated tariff COGS. MRR is shown
          for SaaS context only and is never used as cash. No demo revenue or invented expenses. Unknown AI
          cost is not treated as $0. An incomplete usage read makes this profit partial. OpenAI reconciled
          spend is shown separately and is not included in this formula.
        </p>
      </div>

      {snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error}
        </div>
      ) : null}

      {snapshot.profitUnavailableNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.profitUnavailableNote}
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
          value={knownAmount(snapshot.collectedThisMonthUsd)}
          detail={
            snapshot.collectedThisMonthUsd == null
              ? "Subscription payments are unavailable"
              : "Succeeded subscription payments only"
          }
        />
        <Kpi
          label="MRR"
          value={knownAmount(snapshot.mrrUsd)}
          detail={snapshot.mrrUsd == null ? "Host subscriptions are unavailable" : snapshot.mrrNote}
        />
        <Kpi
          label="Payroll"
          value={knownAmount(snapshot.payrollThisMonthUsd)}
          detail={
            snapshot.payrollThisMonthUsd == null
              ? "Operating expenses are unavailable"
              : "business_expenses · payroll"
          }
        />
        <Kpi
          label="Contractors"
          value={knownAmount(snapshot.contractorsThisMonthUsd)}
          detail="Counted once in total operating costs"
        />
        <Kpi
          label="Other Operating Expenses"
          value={knownAmount(snapshot.otherOperatingThisMonthUsd)}
          detail="Manual ledger excluding payroll & contractors"
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Isabela AI Costs</p>
          <p className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">{aiValueLabel}</p>
          <p className="mt-2 text-sm text-slate-700">
            {snapshot.isabelaReadUnavailable
              ? "TTS usage is unavailable"
              : "Estimated tariff from Isabela Usage · unknown costs are not $0"}
            {snapshot.isabelaReadIncomplete ? " · incomplete read, not a full-month total" : ""}
          </p>
          <Link href="/backoffice/isabela-usage" className="mt-2 inline-block text-xs font-semibold underline">
            Open Isabela Usage
          </Link>
        </div>
        <Kpi
          label="Total Operating Costs"
          value={totalCostsLabel}
          detail="Payroll + contractors + other OpEx + estimated tariff AI"
        />
        <Kpi
          label={operatingResult.label}
          value={operatingResult.value}
          detail={
            sourcesUnavailable
              ? "Not calculated"
              : snapshot.isabelaAiPricingPartial
                ? PROFIT_PENDING_AI_EXPLANATION
                : snapshot.isabelaReadIncomplete
                  ? "Partial · incomplete TTS read"
                  : `Exactness: ${snapshot.profitExactnessLabel}`
          }
        />
        <Kpi
          label={operatingMargin.label}
          value={operatingMargin.value}
          detail={
            sourcesUnavailable
              ? "Not calculated"
              : snapshot.isabelaAiPricingPartial
                ? PROFIT_PENDING_AI_EXPLANATION
                : snapshot.collectedThisMonthUsd != null && snapshot.collectedThisMonthUsd > 0
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
              value={knownAmount(snapshot.collectedThisMonthUsd)}
            />
            <Line label="MRR (run-rate only · not in profit)" value={knownAmount(snapshot.mrrUsd)} muted />
          </BreakdownBlock>

          <BreakdownBlock title="Costs">
            <Line label="Payroll" value={knownAmount(snapshot.payrollThisMonthUsd)} />
            <Line label="Contractors" value={knownAmount(snapshot.contractorsThisMonthUsd)} />
            {snapshot.otherOperatingThisMonthUsd == null ? (
              <Line label="Other operating (hosting/software/…)" value={PROFIT_UNAVAILABLE_LABEL} />
            ) : snapshot.otherOpexLines.length === 0 ? (
              <Line label="Other operating (hosting/software/…)" value={formatProfitUsd(0)} />
            ) : (
              snapshot.otherOpexLines.map((line) => (
                <Line key={line.category} label={line.label} value={formatProfitUsd(line.amountUsd)} />
              ))
            )}
            <Line
              label={
                snapshot.isabelaReadUnavailable
                  ? "Isabela AI COGS"
                  : snapshot.isabelaAiPricingPartial || snapshot.profitIsPartial
                    ? "Isabela AI COGS (estimated tariff · partial)"
                    : "Isabela AI COGS (estimated tariff)"
              }
              value={aiValueLabel}
            />
            <Line label="Total operating costs" value={totalCostsLabel} strong />
          </BreakdownBlock>

          <BreakdownBlock title="Result">
            <Line label={operatingResult.label} value={operatingResult.value} strong />
            <Line label={operatingMargin.label} value={operatingMargin.value} />
          </BreakdownBlock>
        </div>
      </section>

      <OpenAiReconciledSpendCard reconciliation={reconciliation} />
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
