import type { Metadata } from "next";
import Link from "next/link";
import { formatUsdFromCents, getAiUsageMonthSnapshot } from "@/lib/ai-usage";

export const metadata: Metadata = {
  title: "Isabela Usage · Zencierge Founder Back Office",
};

export const dynamic = "force-dynamic";

export default async function BackOfficeIsabelaUsagePage() {
  const snapshot = await getAiUsageMonthSnapshot();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Isabela Usage</h1>
        <p className="mt-1 text-lg text-slate-700">
          Measured TTS for {snapshot.monthLabel} · {snapshot.timeZone}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Phase 2: ElevenLabs character costs are exact. OpenAI TTS stays pending until exact metering exists.
        </p>
      </div>

      {snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error}
        </div>
      ) : null}

      {snapshot.totalsArePartial && snapshot.partialTotalsNote ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.partialTotalsNote}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="TTS requests" value={snapshot.ttsRequests} detail="All measured TTS this month" />
        <MetricCard
          label="Characters synthesized"
          value={snapshot.charactersSynthesized}
          detail="Successful TTS input characters"
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Exact tracked cost</p>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{snapshot.exactTrackedCostLabel}</p>
          <p className="mt-2 text-sm text-slate-700">ElevenLabs (and any other exact rules) only</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Awaiting exact pricing</p>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">
            {snapshot.pendingExactPricingEvents.toLocaleString("en-US")}
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {snapshot.pendingExactPricingCharacters.toLocaleString("en-US")} chars · shown as — not zero dollars
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Provider breakdown</h2>
          {snapshot.byProvider.length === 0 ? (
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
          {snapshot.byModel.length === 0 ? (
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
          <p className="mt-1 text-xs text-slate-500">Exact-cost events only. Complimentary hosts still count as COGS.</p>
          {snapshot.costPerCustomer.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No exact-cost customer attribution this month.</p>
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
          <p className="mt-1 text-xs text-slate-500">Exact-cost events only (reservation_id).</p>
          {snapshot.costPerStay.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No exact-cost stay attribution this month.</p>
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

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Provider actual spend</h2>
        <p className="mt-2 text-sm font-semibold text-slate-800">{snapshot.openaiSpendReconciliation}</p>
        <p className="mt-2 text-sm text-slate-600">{snapshot.costNote}</p>
        <p className="mt-3 text-xs text-slate-500">
          UTC range: {snapshot.rangeStartUtc} → {snapshot.rangeEndUtc}
        </p>
        <Link href="/backoffice" className="mt-4 inline-block text-sm font-semibold text-slate-800 underline">
          Back to Overview
        </Link>
      </div>
    </div>
  );
}

function MetricCard(input: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">{input.label}</p>
      <p className="mt-3 text-4xl font-extrabold text-slate-900">{input.value.toLocaleString("en-US")}</p>
      <p className="mt-2 text-sm text-slate-700">{input.detail}</p>
    </div>
  );
}
