"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import {
  SUPPLY_CATALOG,
  SUPPLY_SKUS,
  type PropertySupplySnapshot,
  type SupplySku,
} from "@/lib/property-supplies";
import { upsertLocalSnapshot } from "@/lib/property-supplies-local";

const emptyCounts = () =>
  Object.fromEntries(SUPPLY_SKUS.map((sku) => [sku, { remaining: "", missing: false }])) as Record<
    SupplySku,
    { remaining: string; missing: boolean }
  >;

export function TurnoverSupplyForm({
  propertyId,
  reservationId,
  staffName,
  compact = false,
}: {
  propertyId: string;
  reservationId?: string;
  staffName?: string;
  compact?: boolean;
}) {
  const [counts, setCounts] = useState(emptyCounts);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/supplies?propertyId=${encodeURIComponent(propertyId)}`);
        const data = (await response.json()) as { snapshots?: PropertySupplySnapshot[] };
        const snapshot = data.snapshots?.[0];
        if (cancelled || !snapshot) return;
        setCounts(
          Object.fromEntries(
            SUPPLY_SKUS.map((sku) => {
              const item = snapshot.items.find((row) => row.sku === sku);
              return [sku, { remaining: item ? String(item.currentStock) : "", missing: false }];
            }),
          ) as ReturnType<typeof emptyCounts>,
        );
      } catch {
        /* keep blanks; staff can still type counts */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const missingLabels = useMemo(
    () => SUPPLY_SKUS.filter((sku) => counts[sku].missing).map((sku) => SUPPLY_CATALOG[sku].label),
    [counts],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!propertyId) {
      setError("Select a property first.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        propertyId,
        reservationId,
        staffName,
        notes,
        counts: SUPPLY_SKUS.map((sku) => ({
          sku,
          remaining: counts[sku].missing ? 0 : Number(counts[sku].remaining) || 0,
          missing: counts[sku].missing,
        })),
      };
      const response = await fetch("/api/supplies/turnover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        error?: string;
        snapshot?: PropertySupplySnapshot;
        missingSkus?: SupplySku[];
      };
      if (!response.ok) throw new Error(data.error ?? "Could not save supplies");
      if (data.snapshot) {
        upsertLocalSnapshot(data.snapshot, undefined);
      }
      const missing = (data.missingSkus ?? []).map((sku) => SUPPLY_CATALOG[sku].label);
      setNotice(
        missing.length
          ? `Saved. Flagged missing: ${missing.join(", ")}. Host shopping list updated.`
          : "Saved. Consumable counts are on the host supply board.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save supplies");
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500";

  return (
    <form onSubmit={(event) => void submit(event)} className={compact ? "space-y-3" : "space-y-4"}>
      <header className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-800">End of clean</p>
        <h2 className={compact ? "text-base font-bold text-slate-950" : "text-xl font-black text-slate-950"}>
          Consumable count
        </h2>
        <p className="text-sm text-slate-600">
          Log what is left on the shelves. Check missing if a guest used the last of it or it was not restocked.
        </p>
      </header>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

      <ul className="space-y-2">
        {SUPPLY_SKUS.map((sku) => {
          const catalog = SUPPLY_CATALOG[sku];
          const row = counts[sku];
          return (
            <li key={sku} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{catalog.label}</p>
                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700">
                  <input
                    type="checkbox"
                    checked={row.missing}
                    onChange={(event) =>
                      setCounts((current) => ({
                        ...current,
                        [sku]: { ...current[sku], missing: event.target.checked },
                      }))
                    }
                  />
                  Missing
                </label>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  inputMode="decimal"
                  disabled={row.missing}
                  value={row.missing ? "0" : row.remaining}
                  onChange={(event) =>
                    setCounts((current) => ({
                      ...current,
                      [sku]: { ...current[sku], remaining: event.target.value },
                    }))
                  }
                  className={fieldClass}
                  aria-label={`${catalog.label} remaining`}
                />
                <span className="shrink-0 text-xs font-medium text-slate-500">{catalog.unit}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <label className="block text-sm font-semibold text-slate-700">
        Notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className={`${fieldClass} mt-1.5`}
          placeholder="e.g. coffee almost gone, need Costco run"
        />
      </label>

      {missingLabels.length ? (
        <p className="text-xs font-semibold text-rose-700">Will flag: {missingLabels.join(", ")}</p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !propertyId}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-500 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Save turnover supplies
      </button>
    </form>
  );
}
