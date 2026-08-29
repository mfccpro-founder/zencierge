"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AdminSubscriberRow, PaymentState } from "@/lib/admin-billing";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

const PAGE_SIZE = 12;

const STATE_BADGE: Record<PaymentState, { label: string; className: string }> = {
  al_dia: { label: "Active (Up to Date)", className: "border-emerald-800 bg-emerald-700 text-white" },
  moroso: { label: "Past Due", className: "border-rose-800 bg-rose-700 text-white" },
  cancelado: { label: "Canceled", className: "border-slate-800 bg-slate-700 text-white" },
  sin_suscripcion: { label: "No Subscription", className: "border-amber-800 bg-amber-600 text-white" },
};

const FILTERS: { id: "all" | PaymentState; label: string }[] = [
  { id: "all", label: "All" },
  { id: "al_dia", label: "Active" },
  { id: "moroso", label: "Past due" },
  { id: "cancelado", label: "Canceled" },
  { id: "sin_suscripcion", label: "No plan" },
];

export function AdminHostsTable({
  subscribers,
  initialFilter = "all",
}: {
  subscribers: AdminSubscriberRow[];
  initialFilter?: "all" | PaymentState;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | PaymentState>(initialFilter);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return subscribers.filter((row) => {
      if (status !== "all" && row.paymentState !== status) return false;
      if (!needle) return true;
      const name = (row.fullName ?? "").toLowerCase();
      return name.includes(needle) || row.email.toLowerCase().includes(needle);
    });
  }, [subscribers, query, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const setFilter = (next: "all" | PaymentState) => {
    setStatus(next);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search by host name or email"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none lg:max-w-md"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                status === chip.id
                  ? "border-slate-800 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm font-medium text-slate-700">
        Showing {slice.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–
        {(safePage - 1) * PAGE_SIZE + slice.length} of {filtered.length} hosts
      </p>

      <div className="max-h-[650px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-base">
          <thead className="sticky top-0 z-10 bg-slate-100/95 text-sm font-semibold uppercase tracking-wide text-slate-900 shadow-xs backdrop-blur-sm">
            <tr>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Host Name
              </th>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Email
              </th>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Phone
              </th>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Plan
              </th>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Payment Status
              </th>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Last Payment
              </th>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Next Billing
              </th>
              <th className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-6 py-4 text-slate-900 shadow-xs backdrop-blur-sm">
                Alerts
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => {
              const badge = STATE_BADGE[row.paymentState];
              return (
                <tr key={row.userId} className="align-top hover:bg-slate-50">
                  <td className="border-b border-slate-300 px-6 py-5">
                    <p className="font-semibold text-slate-900">{row.fullName ?? "—"}</p>
                    <p className="mt-1 font-mono text-xs text-slate-700">{row.userId.slice(0, 8)}…</p>
                  </td>
                  <td className="border-b border-slate-300 px-6 py-5 font-medium text-slate-900">{row.email}</td>
                  <td className="border-b border-slate-300 px-6 py-5 text-slate-900">{row.phone ?? "—"}</td>
                  <td className="border-b border-slate-300 px-6 py-5">
                    <p className="text-slate-900">{row.planName}</p>
                    <p className="mt-1 text-sm text-slate-700">${row.monthlyUsd}/mo</p>
                  </td>
                  <td className="border-b border-slate-300 px-6 py-5">
                    <span className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${badge.className}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="border-b border-slate-300 px-6 py-5 text-slate-900">{formatDate(row.lastPaymentAt)}</td>
                  <td className="border-b border-slate-300 px-6 py-5 text-slate-900">{formatDate(row.nextChargeAt)}</td>
                  <td className="border-b border-slate-300 px-6 py-5">
                    {row.alerts.length === 0 ? (
                      <span className="text-sm text-slate-700">—</span>
                    ) : (
                      <ul className="space-y-2">
                        {row.alerts.map((alert) => (
                          <li key={`${row.userId}-${alert.tag}`} className="flex flex-col gap-0.5">
                            <span className="inline-block w-fit rounded-md border border-rose-800 bg-rose-700 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
                              ⚠ {alert.tag}
                            </span>
                            <span className="text-sm font-medium text-slate-900">{alert.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
            {slice.length === 0 ? (
              <tr>
                <td colSpan={8} className="border-b border-slate-300 px-6 py-12 text-center text-lg text-slate-900">
                  No hosts match this search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700">
          Page {safePage} of {pageCount} · {PAGE_SIZE} per page
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
