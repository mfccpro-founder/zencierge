import {
  presentOpenAiReconciledSpend,
  type OpenAiCostsReconciliation,
} from "@/lib/openai-costs";

export function OpenAiReconciledSpendCard(input: { reconciliation: OpenAiCostsReconciliation }) {
  const view = presentOpenAiReconciledSpend(input.reconciliation);
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">OpenAI reconciled spend</h2>
      <p className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">{view.value}</p>
      <p className="mt-3 text-sm text-slate-700">Scope: {view.scopeLabel}</p>
      <p className="mt-1 text-sm text-slate-700">UTC window: {view.utcWindowLabel}</p>
      <p className="mt-1 text-sm text-slate-700">New York month: {view.nyMonthLabel}</p>
      <p className="mt-2 text-sm text-slate-600">{view.equivalenceNote}</p>
      {view.openDayNote ? <p className="mt-1 text-sm text-slate-600">{view.openDayNote}</p> : null}
      {view.statusNote ? <p className="mt-2 text-sm font-medium text-slate-800">{view.statusNote}</p> : null}
      <p className="mt-3 text-xs text-slate-500">{view.separationNote}</p>
    </section>
  );
}
