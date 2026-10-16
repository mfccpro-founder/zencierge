import type { Metadata } from "next";
import Link from "next/link";
import { OpenAiReconciledSpendCard } from "@/components/admin/openai-reconciled-spend-card";
import {
  AI_USAGE_UNAVAILABLE_LABEL,
  formatUsdFromCents,
  getAiUsageMonthSnapshot,
  presentAiUsageCount,
  presentAiUsageTariff,
} from "@/lib/ai-usage";
import { readOpenAiBackOfficeCosts } from "@/lib/openai-costs-read";

export const metadata: Metadata = {
  title: "Isabela Usage · Zencierge Founder Back Office",
};

export const dynamic = "force-dynamic";

export default async function BackOfficeIsabelaUsagePage() {
  const [snapshot, reconciliation] = await Promise.all([
    getAiUsageMonthSnapshot(),
    readOpenAiBackOfficeCosts(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Isabela Usage</h1>
        <p className="mt-1 text-lg text-slate-700">
          Measured TTS for {snapshot.monthLabel} · {snapshot.timeZone}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Tariff amounts are estimates from configured local rates, including historical rows stored as exact.
          Unknown costs stay unknown. OpenAI reconciled spend is a separate card and is not this tariff.
        </p>
      </div>

      {snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error}
        </div>
      ) : null}

      {snapshot.readUnavailable && snapshot.readUnavailableNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.readUnavailableNote}
        </div>
      ) : null}

      {snapshot.readIncomplete && snapshot.readIncompleteNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.readIncompleteNote}
        </div>
      ) : null}

      {snapshot.totalsArePartial && snapshot.partialTotalsNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.partialTotalsNote}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MeasureCard
          label="TTS requests"
          value={presentAiUsageCount(snapshot.ttsRequests, snapshot.readUnavailable)}
          detail={
            snapshot.readUnavailable ? "TTS usage is unavailable" : "All measured TTS this month"
          }
        />
        <MeasureCard
          label="Characters synthesized"
          value={presentAiUsageCount(snapshot.charactersSynthesized, snapshot.readUnavailable)}
          detail={
            snapshot.readUnavailable
              ? "TTS usage is unavailable"
              : "Successful TTS input characters"
          }
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Estimated tariff cost</p>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">
            {snapshot.readIncomplete && !snapshot.readUnavailable ? "Incomplete · " : ""}
            {presentAiUsageTariff({
              unavailable: snapshot.readUnavailable,
              label: snapshot.exactTrackedCostLabel,
              requests: snapshot.ttsRequests,
              readIncomplete: snapshot.readIncomplete,
              totalsArePartial: snapshot.totalsArePartial,
            })}
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {snapshot.readUnavailable
              ? "TTS usage is unavailable"
              : "Configured local tariff, including historical rows stored as exact"}
            {snapshot.readIncomplete ? " · incomplete read, not a full-month total" : ""}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Cost unknown</p>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">
            {presentAiUsageCount(snapshot.pendingExactPricingEvents, snapshot.readUnavailable)}
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {snapshot.readUnavailable
              ? AI_USAGE_UNAVAILABLE_LABEL
              : `${snapshot.pendingExactPricingCharacters.toLocaleString("en-US")} chars · shown as — not zero dollars`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Provider breakdown</h2>
          {snapshot.readUnavailable ? (
            <p className="mt-3 text-sm text-slate-600">{AI_USAGE_UNAVAILABLE_LABEL}</p>
          ) : snapshot.byProvider.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No measured TTS events this month yet.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm text-slate-800">
              {snapshot.byProvider.map((row) => (
                <li key={row.provider} className="border-b border-slate-100 pb-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{row.costClassLabel}</span>
                    <span className="text-slate-600">
                      {row.exactCostCents == null ? "—" : formatUsdFromCents(row.exactCostCents)}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {row.requests} req · {row.characters.toLocaleString("en-US")} chars
                    {row.pendingEvents > 0 ? ` · ${row.pendingEvents} pending` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Model breakdown</h2>
          {snapshot.readUnavailable ? (
            <p className="mt-3 text-sm text-slate-600">{AI_USAGE_UNAVAILABLE_LABEL}</p>
          ) : snapshot.byModel.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No measured TTS events this month yet.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm text-slate-800">
              {snapshot.byModel.map((row) => (
                <li key={`${row.provider}:${row.model}`} className="border-b border-slate-100 pb-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">
                      {row.provider} / {row.model}
                    </span>
                    <span className="text-slate-600">
                      {row.exactCostCents == null ? "—" : formatUsdFromCents(row.exactCostCents)}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {row.costClassLabel} · {row.requests} req · {row.characters.toLocaleString("en-US")} chars
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Cost per customer</h2>
          <p className="mt-1 text-xs text-slate-500">
            Estimated tariff events only. Complimentary hosts still count as COGS. Unknown costs are excluded.
          </p>
          {snapshot.readUnavailable ? (
            <p className="mt-3 text-sm text-slate-600">{AI_USAGE_UNAVAILABLE_LABEL}</p>
          ) : snapshot.costPerCustomer.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No estimated-tariff customer attribution this month.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm text-slate-800">
              {snapshot.costPerCustomer.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2">
                  <span className="font-mono text-xs">{row.id}</span>
                  <span>
                    {formatUsdFromCents(row.exactCostCents)} · {row.exactEvents} events
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Cost per stay</h2>
          <p className="mt-1 text-xs text-slate-500">
            Estimated tariff events only (reservation_id). Unknown costs are excluded.
          </p>
          {snapshot.readUnavailable ? (
            <p className="mt-3 text-sm text-slate-600">{AI_USAGE_UNAVAILABLE_LABEL}</p>
          ) : snapshot.costPerStay.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No estimated-tariff stay attribution this month.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm text-slate-800">
              {snapshot.costPerStay.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2">
                  <span className="font-mono text-xs">{row.id}</span>
                  <span>
                    {formatUsdFromCents(row.exactCostCents)} · {row.exactEvents} events
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <OpenAiReconciledSpendCard reconciliation={reconciliation} />
      <Link href="/backoffice" className="inline-block text-sm font-semibold text-slate-800 underline">
        Back to Overview
      </Link>
    </div>
  );
}

function MeasureCard(input: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">{input.label}</p>
      <p className="mt-3 text-4xl font-extrabold text-slate-900">{input.value}</p>
      <p className="mt-2 text-sm text-slate-700">{input.detail}</p>
    </div>
  );
}
