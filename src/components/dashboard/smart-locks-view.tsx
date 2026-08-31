"use client";

import { useState } from "react";
import type { Property } from "@/lib/dashboard-data";
import { smartLockItemFromProperty, type LockStatus, type SmartLockItem } from "@/lib/smart-locks";

const STATUS_LABEL: Record<LockStatus, string> = {
  online: "Online",
  offline: "Offline",
  jammed: "Jammed",
};

const STATUS_CLASS: Record<LockStatus, string> = {
  online: "text-emerald-800",
  offline: "text-slate-600",
  jammed: "text-amber-800",
};

export function SmartLocksView({
  listings,
  onViewPins,
  onLinkLock,
}: {
  listings: Property[];
  onViewPins: (propertyId: string) => void;
  onLinkLock: () => void;
}) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncedId, setSyncedId] = useState<string | null>(null);
  const devices: SmartLockItem[] = listings.map(smartLockItemFromProperty);

  const sync = (lockId: string) => {
    setSyncingId(lockId);
    window.setTimeout(() => {
      setSyncingId(null);
      setSyncedId(lockId);
      window.setTimeout(() => setSyncedId((current) => (current === lockId ? null : current)), 1600);
    }, 700);
  };

  return (
    <section
      id="smart-locks"
      className="scroll-mt-28 space-y-6 rounded-2xl border border-sky-200 bg-white p-4 text-slate-900 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Smart Lock Sync</h2>
          <p className="text-sm text-slate-600">
            Monitor connected locks, battery, and guest PINs for each listing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
            Seam API connected
          </span>
          <button
            type="button"
            onClick={onLinkLock}
            className="rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-sky-500"
          >
            + Link lock
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-sky-800">Registered devices</h3>

        {devices.length === 0 ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-6 text-sm text-slate-700">
            No listings yet. Add a property, then link a Yale, August, or Schlage lock through Seam.
          </p>
        ) : (
          devices.map((lock) => (
            <div
              key={lock.id}
              className="flex flex-col items-start justify-between gap-4 rounded-xl border border-sky-200 bg-sky-50 p-5 shadow-sm transition-colors hover:border-sky-300 md:flex-row md:items-center"
            >
              <div className="space-y-1">
                <span className="rounded border border-sky-200 bg-white px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-sky-800">
                  {lock.propertyName}
                </span>
                <h3 className="mt-1 text-lg font-bold text-slate-900">
                  {lock.lockName} ({lock.brand})
                </h3>
                <p className="text-xs text-slate-600">
                  Battery:{" "}
                  <span className="font-medium text-emerald-800">{lock.batteryLevel}%</span>
                  {" • "}
                  Status:{" "}
                  <span className={`font-medium ${STATUS_CLASS[lock.status]}`}>
                    {STATUS_LABEL[lock.status]}
                  </span>
                  {lock.doorCode ? (
                    <>
                      {" • "}
                      PIN <span className="font-mono font-medium text-slate-900">{lock.doorCode}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <div className="flex w-full items-center justify-end gap-3 md:w-auto">
                <button
                  type="button"
                  onClick={() => onViewPins(lock.propertyId)}
                  className="rounded-md border border-sky-200 bg-white px-3.5 py-2 text-xs font-medium text-sky-900 shadow-sm transition-colors hover:bg-sky-100"
                >
                  View PIN codes
                </button>
                <button
                  type="button"
                  onClick={() => sync(lock.id)}
                  disabled={syncingId === lock.id}
                  className="rounded-md bg-sky-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
                >
                  {syncingId === lock.id ? "Syncing…" : syncedId === lock.id ? "Synced" : "Sync"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
