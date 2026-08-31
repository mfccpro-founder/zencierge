"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ClipboardList, Package, ShoppingCart } from "lucide-react";
import {
  buildShoppingList,
  mergeSnapshots,
  restockBelowThreshold,
  restockItem,
  snapshotOverallLevel,
  stockLevel,
  type PropertySupplySnapshot,
  type ShoppingListLine,
  type StockLevel,
  type SupplyLogEntry,
  type SupplySku,
} from "@/lib/property-supplies";
import {
  SUPPLIES_UPDATED_EVENT,
  ensureSnapshotsForProperties,
  readLocalSupplies,
  writeLocalSupplies,
} from "@/lib/property-supplies-local";

const LEVEL_STYLE: Record<StockLevel, string> = {
  optimal: "border-emerald-300 bg-emerald-100 text-emerald-900",
  low: "border-amber-300 bg-amber-100 text-amber-950",
  critical: "border-rose-300 bg-rose-100 text-rose-900",
};

const DOT: Record<StockLevel, string> = {
  optimal: "bg-emerald-500",
  low: "bg-amber-400",
  critical: "bg-rose-500",
};

type BoardPayload = {
  snapshots?: PropertySupplySnapshot[];
  logs?: SupplyLogEntry[];
  names?: Record<string, string>;
  persisted?: "supabase" | "local";
  properties?: Array<{ id: string; name: string }>;
};

export function SupplyTrackingView() {
  const [snapshots, setSnapshots] = useState<PropertySupplySnapshot[]>([]);
  const [logs, setLogs] = useState<SupplyLogEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [persisted, setPersisted] = useState<"supabase" | "local">("local");
  const [busySku, setBusySku] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback((remote: BoardPayload) => {
    const local = readLocalSupplies();
    const remoteSnapshots = remote.snapshots ?? [];
    const propertyIds =
      remote.properties?.map((property) => property.id) ??
      [...new Set([...remoteSnapshots.map((row) => row.propertyId), ...local.snapshots.map((row) => row.propertyId)])];
    const merged = ensureSnapshotsForProperties(propertyIds, mergeSnapshots(local.snapshots, remoteSnapshots));
    const nextLogs = [...(local.logs ?? []), ...(remote.logs ?? [])]
      .filter((row, index, list) => list.findIndex((item) => item.id === row.id) === index)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 40);
    const nextNames = {
      ...(remote.names ?? {}),
      ...Object.fromEntries((remote.properties ?? []).map((property) => [property.id, property.name])),
    };
    setSnapshots(merged);
    setLogs(nextLogs);
    setNames(nextNames);
    setPersisted(remote.persisted === "supabase" ? "supabase" : "local");
    writeLocalSupplies({ snapshots: merged, logs: nextLogs });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/supplies");
      const data = (await response.json()) as BoardPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load supplies");
      hydrate(data);
      setError(null);
    } catch (cause) {
      hydrate({});
      setError(cause instanceof Error ? cause.message : "Using local inventory");
    }
  }, [hydrate]);

  useEffect(() => {
    void refresh();
    const onUpdate = () => {
      const local = readLocalSupplies();
      if (local.snapshots.length) setSnapshots(local.snapshots);
      if (local.logs.length) setLogs(local.logs);
    };
    window.addEventListener(SUPPLIES_UPDATED_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(SUPPLIES_UPDATED_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, [refresh]);

  const shoppingList = useMemo(() => buildShoppingList(snapshots, names), [snapshots, names]);
  const criticalCount = snapshots.filter((row) => snapshotOverallLevel(row) === "critical").length;

  const persistSnapshot = async (
    next: PropertySupplySnapshot,
    extra?: { restockSku?: SupplySku; restockAllLow?: boolean },
  ) => {
    setBusySku(extra?.restockSku ?? next.propertyId);
    const local = readLocalSupplies();
    writeLocalSupplies({
      snapshots: local.snapshots.map((row) => (row.propertyId === next.propertyId ? next : row)),
      logs: local.logs,
    });
    setSnapshots((current) => current.map((row) => (row.propertyId === next.propertyId ? next : row)));
    try {
      const response = await fetch("/api/supplies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: next, propertyId: next.propertyId, ...extra }),
      });
      const data = (await response.json()) as { snapshot?: PropertySupplySnapshot; persisted?: "supabase" | "local"; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not restock");
      if (data.snapshot) {
        setSnapshots((current) => current.map((row) => (row.propertyId === data.snapshot!.propertyId ? data.snapshot! : row)));
        const latest = readLocalSupplies();
        writeLocalSupplies({
          snapshots: latest.snapshots.map((row) => (row.propertyId === data.snapshot!.propertyId ? data.snapshot! : row)),
          logs: latest.logs,
        });
      }
      if (data.persisted) setPersisted(data.persisted);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved locally only");
    } finally {
      setBusySku(null);
    }
  };

  const copyList = async (lines: ShoppingListLine[]) => {
    const text = lines
      .map((line) => `${line.propertyName}: ${line.qtyToBuy} ${line.unit} ${line.label} (have ${line.currentStock}, min ${line.minThreshold})`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || "No items below threshold.");
    } catch {
      window.prompt("Shopping list", text);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section id="supply-tracking" className="scroll-mt-28 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-orange-800">Module 3</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Property supply tracking</h2>
          <p className="mt-1 text-sm text-slate-700">
            Toilet paper, towels, coffee, soap/shampoo, and trash bags — per listing, with a restock light and auto shopping list.
          </p>
        </div>
        <p className="text-xs font-semibold text-slate-600">
          {persisted === "supabase" ? "Synced to Supabase" : "Saved on this device"}
          {criticalCount ? ` · ${criticalCount} listing(s) below threshold` : ""}
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
            <ShoppingCart className="h-4 w-4 text-orange-600" />
            Auto shopping list
          </div>
          <button
            type="button"
            onClick={() => void copyList(shoppingList)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy list"}
          </button>
        </div>
        {shoppingList.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">Every listing is at or above its min threshold.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {shoppingList.map((line) => (
              <li key={`${line.propertyId}-${line.sku}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">
                    {line.qtyToBuy} {line.unit} · {line.label}
                  </p>
                  <p className="text-xs text-slate-600">
                    {line.propertyName} · on hand {line.currentStock} / min {line.minThreshold}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${LEVEL_STYLE.critical}`}>
                  Critical
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {snapshots.map((snapshot) => {
          const overall = snapshotOverallLevel(snapshot);
          const listingName = names[snapshot.propertyId] || snapshot.propertyId;
          const needsRestock = snapshot.items.some((item) => item.currentStock < item.minThreshold);
          return (
            <article key={snapshot.propertyId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{listingName}</h3>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {snapshot.lastTurnoverAt
                      ? `Last turnover ${new Date(snapshot.lastTurnoverAt).toLocaleString()} · ${snapshot.lastStaffName || "staff"}`
                      : "No turnover count yet"}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${LEVEL_STYLE[overall]}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[overall]}`} />
                  {overall}
                </span>
              </div>

              <ul className="mt-3 space-y-2">
                {snapshot.items.map((item) => {
                  const level = stockLevel(item.currentStock, item.minThreshold);
                  return (
                    <li key={item.sku} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[level]}`} title={level} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                        <p className="text-[11px] text-slate-600">
                          {item.currentStock} {item.unit} · min {item.minThreshold}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busySku !== null}
                        onClick={() => void persistSnapshot(restockItem(snapshot, item.sku), { restockSku: item.sku })}
                        className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold uppercase text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Restock
                      </button>
                    </li>
                  );
                })}
              </ul>

              {needsRestock ? (
                <button
                  type="button"
                  disabled={busySku !== null}
                  onClick={() => void persistSnapshot(restockBelowThreshold(snapshot), { restockAllLow: true })}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-orange-500 disabled:opacity-50"
                >
                  <Package className="h-3.5 w-3.5" />
                  Quick restock below threshold
                </button>
              ) : null}
            </article>
          );
        })}
      </div>

      {logs.length ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Recent counts</p>
          <ul className="mt-2 space-y-1.5">
            {logs.slice(0, 8).map((log) => (
              <li key={log.id} className="flex items-start gap-2 text-xs text-slate-700">
                {log.missingSkus.length ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                ) : (
                  <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                )}
                <span>
                  <span className="font-semibold">{names[log.propertyId] || log.propertyId}</span>
                  {" · "}
                  {log.eventType}
                  {log.staffName ? ` · ${log.staffName}` : ""}
                  {log.notes ? ` — ${log.notes}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
