"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Camera } from "lucide-react";
import { housekeepingCategoryLabel, type HousekeepingReport } from "@/lib/housekeeping-photos";

export function HousekeepingReportsHistory() {
  const searchParams = useSearchParams();
  const focusProperty = searchParams.get("property")?.trim() ?? "";
  const [reports, setReports] = useState<HousekeepingReport[]>([]);
  const [filter, setFilter] = useState(focusProperty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focusProperty) setFilter(focusProperty);
  }, [focusProperty]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/housekeeping/reports", { cache: "no-store" });
        const data = (await response.json()) as { reports?: HousekeepingReport[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not load reports.");
        setReports(data.reports ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load reports.");
      }
    })();
  }, []);

  const properties = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of reports) map.set(row.propertyId, row.propertyName);
    return [...map.entries()];
  }, [reports]);

  const visible = reports.filter((row) => !filter || row.propertyId === filter);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Housekeeping photo reports</h2>
        <p className="mt-1 text-sm text-slate-600">
          History of status photos sent by cleaning staff, with timestamps and notes.
        </p>
      </div>
      {properties.length > 1 ? (
        <label className="block text-sm font-semibold text-slate-700">
          Property
          <select
            className="mt-1.5 w-full max-w-sm rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="">All properties</option>
            {properties.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-700">
          No photo reports yet. Staff can send them from the housekeeping upload link or the guest portal staff button.
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((report) => (
            <li key={report.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">{report.propertyName}</p>
                  <p className="text-xs text-slate-500">
                    {report.propertyCity}
                    {report.staffName ? ` · ${report.staffName}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-800">
                  {housekeepingCategoryLabel(report.category)}
                </span>
              </div>
              <p className="mt-2 text-xs font-medium text-slate-500">
                {new Date(report.createdAt).toLocaleString("en-US")}
              </p>
              {report.notes ? <p className="mt-2 text-sm text-slate-800">{report.notes}</p> : null}
              <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {report.photos.map((photo) => (
                  <li key={photo.id} className="overflow-hidden rounded-xl bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.imageUrl} alt="" className="h-24 w-full object-cover" />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Camera className="h-3.5 w-3.5" />
        Staff camera uploads appear here as soon as they are sent.
      </p>
    </section>
  );
}
