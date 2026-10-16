import type { Metadata } from "next";
import Link from "next/link";
import { BackOfficeExpensesPanel } from "@/components/admin/backoffice-expenses-panel";
import { OpenAiReconciledSpendCard } from "@/components/admin/openai-reconciled-spend-card";
import { formatExpenseUsd, getAdminExpensesSnapshot } from "@/lib/admin-expenses";
import { AI_USAGE_UNAVAILABLE_LABEL } from "@/lib/ai-usage";
import { PROFIT_UNAVAILABLE_LABEL } from "@/lib/admin-profit-shared";
import { incomeCalendarMonthUtcBounds } from "@/lib/admin-income";
import { readOpenAiBackOfficeCosts } from "@/lib/openai-costs-read";

export const metadata: Metadata = {
  title: "Payroll & Expenses · Zencierge Founder Back Office",
  description: "Zencierge company payroll and operating expenses plus the Isabela tariff estimate.",
};

export const dynamic = "force-dynamic";

export default async function BackOfficePayrollExpensesPage() {
  const [snapshot, reconciliation] = await Promise.all([
    getAdminExpensesSnapshot(),
    readOpenAiBackOfficeCosts(),
  ]);
  const ledgerLabel = (amount: number | null) =>
    snapshot.expensesReadUnavailable || amount == null ? PROFIT_UNAVAILABLE_LABEL : formatExpenseUsd(amount);
  const month = incomeCalendarMonthUtcBounds(new Date(), snapshot.timeZone);
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: snapshot.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = todayParts.find((part) => part.type === "year")?.value ?? String(month.year);
  const m = todayParts.find((part) => part.type === "month")?.value ?? "01";
  const d = todayParts.find((part) => part.type === "day")?.value ?? "01";
  const todayIsoDate = `${y}-${m}-${d}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Payroll & Expenses
        </h1>
        <p className="mt-1 text-lg text-slate-700">
          Zencierge company costs · {snapshot.monthLabel} · {snapshot.timeZone}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Manual ledger for payroll and OpEx. AI costs are the Isabela Usage tariff estimate so Profit will not
          double-count TTS spend. Unknown costs are not $0. An incomplete usage read is marked partial. OpenAI
          reconciled spend is shown separately and is not added to that tariff or this ledger.
        </p>
      </div>

      {snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error}
        </div>
      ) : null}

      {snapshot.isabelaReadUnavailable && snapshot.isabelaReadUnavailableNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.isabelaReadUnavailableNote}
        </div>
      ) : null}

      {snapshot.isabelaReadIncomplete && snapshot.isabelaReadIncompleteNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.isabelaReadIncompleteNote}
        </div>
      ) : null}

      {snapshot.isabelaAiPricingPartial && snapshot.isabelaAiPricingNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.isabelaAiPricingNote}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Expenses this month"
          value={ledgerLabel(snapshot.manualExpensesThisMonthUsd)}
          detail={snapshot.expensesReadUnavailable ? "Operating expenses are unavailable" : "Manual ledger only"}
        />
        <Kpi
          label="Payroll this month"
          value={ledgerLabel(snapshot.payrollThisMonthUsd)}
          detail={snapshot.expensesReadUnavailable ? "Operating expenses are unavailable" : "category = payroll"}
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">AI costs this month</p>
          <p className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">
            {snapshot.isabelaReadUnavailable
              ? AI_USAGE_UNAVAILABLE_LABEL
              : `${snapshot.isabelaReadIncomplete ? "Incomplete · " : ""}${snapshot.isabelaExactAiCostLabel}`}
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {snapshot.isabelaReadUnavailable
              ? "TTS usage is unavailable"
              : "Isabela Usage estimated tariff"}
            {snapshot.isabelaReadIncomplete ? " · incomplete read, not a full-month total" : ""}
            {snapshot.isabelaAiPricingPartial && !snapshot.isabelaReadUnavailable
              ? " · some costs unknown (not $0)"
              : ""}
          </p>
          <Link href="/backoffice/isabela-usage" className="mt-2 inline-block text-xs font-semibold underline">
            Open Isabela Usage
          </Link>
        </div>
        <Kpi
          label="Other operating expenses"
          value={ledgerLabel(snapshot.otherOperatingThisMonthUsd)}
          detail="Manual ledger excluding payroll and contractors"
        />
      </div>

      <p className="text-xs text-slate-500">
        Contractors this month: {ledgerLabel(snapshot.contractorsThisMonthUsd)}. Expenses this month =
        manual ledger only. Other operating excludes payroll and contractors. AI costs = Isabela Usage
        estimated tariff (never written into business_expenses). Unknown costs are not $0.
      </p>

      <OpenAiReconciledSpendCard reconciliation={reconciliation} />

      <BackOfficeExpensesPanel expenses={snapshot.expenses} todayIsoDate={todayIsoDate} />
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
