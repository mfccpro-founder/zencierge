"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AdminSubscriberRow } from "@/lib/admin-billing";
import {
  backOfficeCustomerStatusLabel,
  filterBackOfficeCustomers,
  formatBackOfficePropertyCount,
  isTrialCustomer,
  propertyCountForHost,
  type BackOfficeCustomerFilter,
  type PropertyCountByHostId,
} from "@/lib/backoffice-customers";
import { trialDaysRemaining } from "@/lib/zencierge-plans";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

const PAGE_SIZE = 12;

const FILTERS: { id: BackOfficeCustomerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paying", label: "Paying" },
  { id: "complimentary", label: "Complimentary" },
  { id: "trial", label: "Trial" },
  { id: "past_due", label: "Past Due" },
  { id: "canceled", label: "Canceled" },
];

const STATUS_CLASS: Record<string, string> = {
  Paying: "border-emerald-800 bg-emerald-700 text-white",
  Complimentary: "border-violet-800 bg-violet-700 text-white",
  "Lifetime VIP": "border-amber-800 bg-amber-600 text-white",
  "14-Day Trial": "border-sky-800 bg-sky-700 text-white",
  Trial: "border-sky-800 bg-sky-700 text-white",
  "Past Due": "border-rose-800 bg-rose-700 text-white",
  Canceled: "border-slate-800 bg-slate-700 text-white",
  "No Subscription": "border-amber-800 bg-amber-600 text-white",
};

export function BackOfficeCustomersTable({
  customers,
  propertyCounts,
}: {
  customers: AdminSubscriberRow[];
  propertyCounts: PropertyCountByHostId;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BackOfficeCustomerFilter>("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () => filterBackOfficeCustomers(customers, { query, filter }),
    [customers, query, filter],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
          placeholder="Search by customer name or email"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none lg:max-w-md"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                setFilter(chip.id);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                filter === chip.id
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
        {(safePage - 1) * PAGE_SIZE + slice.length} of {filtered.length} customers
      </p>

      {customers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">No customers yet</p>
          <p className="mt-2 text-sm text-slate-600">
            Live host accounts from billing will appear here. Demo customers are never injected.
          </p>
        </div>
      ) : (
        <div className="max-h-[650px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-base">
            <thead className="sticky top-0 z-10 bg-slate-100/95 text-sm font-semibold uppercase tracking-wide text-slate-900 shadow-xs backdrop-blur-sm">
              <tr>
                <th className="border-b border-slate-300 px-5 py-4">Customer</th>
                <th className="border-b border-slate-300 px-5 py-4">Plan</th>
                <th className="border-b border-slate-300 px-5 py-4">Status</th>
                <th className="border-b border-slate-300 px-5 py-4">Last payment</th>
                <th className="border-b border-slate-300 px-5 py-4">Properties</th>
                <th className="border-b border-slate-300 px-5 py-4">Isabela</th>
                <th className="border-b border-slate-300 px-5 py-4">Square</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => {
                const status = backOfficeCustomerStatusLabel(row);
                const propertyCount = propertyCountForHost(propertyCounts, row.userId);
                return (
                  <tr key={row.userId} className="align-top hover:bg-slate-50">
                    <td className="border-b border-slate-300 px-5 py-4">
                      <Link
                        href={`/backoffice/customers/${row.userId}`}
                        className="font-semibold text-emerald-800 hover:underline"
                      >
                        {row.fullName ?? "—"}
                      </Link>
                      <p className="mt-1 text-sm text-slate-800">{row.email}</p>
                      <p className="mt-1 font-mono text-xs text-slate-500">{row.userId.slice(0, 8)}…</p>
                    </td>
                    <td className="border-b border-slate-300 px-5 py-4">
                      <p className="text-slate-900">{row.planName}</p>
                      <p className="mt-1 text-sm text-slate-700">${row.monthlyUsd}/mo</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{row.rawStatus}</p>
                    </td>
                    <td className="border-b border-slate-300 px-5 py-4">
                      <span
                        className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${
                          STATUS_CLASS[status] ?? STATUS_CLASS["No Subscription"]
                        }`}
                      >
                        {status}
                      </span>
                      {row.complimentaryActive && row.complimentaryEndsAt ? (
                        <p className="mt-2 text-xs text-slate-600">
                          Ends {formatDate(row.complimentaryEndsAt)}
                        </p>
                      ) : null}
                      {isTrialCustomer(row) && row.trialEndsAt ? (
                        <p className="mt-2 text-xs text-slate-600">
                          {trialDaysRemaining(row.trialEndsAt)} day
                          {trialDaysRemaining(row.trialEndsAt) === 1 ? "" : "s"} remaining
                        </p>
                      ) : null}
                    </td>
                    <td className="border-b border-slate-300 px-5 py-4 text-slate-900">
                      {formatDate(row.lastPaymentAt)}
                      {row.failedPayments[0] ? (
                        <p className="mt-1 text-xs text-rose-700">
                          Last failed ${row.failedPayments[0].amountUsd} · {formatDate(row.failedPayments[0].at)}
                        </p>
                      ) : null}
                    </td>
                    <td className="border-b border-slate-300 px-5 py-4 text-sm text-slate-900">
                      {propertyCount > 0 ? (
                        <Link
                          href={`/backoffice/customers/${row.userId}`}
                          className="font-semibold text-emerald-800 hover:underline"
                        >
                          {formatBackOfficePropertyCount(propertyCount)}
                        </Link>
                      ) : (
                        <span className="text-slate-600">0</span>
                      )}
                    </td>
                    <td className="border-b border-slate-300 px-5 py-4 text-sm text-slate-600">
                      Not instrumented
                    </td>
                    <td className="border-b border-slate-300 px-5 py-4 text-xs text-slate-700">
                      <p>Cust: {row.squareCustomerId ?? "—"}</p>
                      <p className="mt-1">Sub: {row.squareSubscriptionId ?? "—"}</p>
                    </td>
                  </tr>
                );
              })}
              {slice.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border-b border-slate-300 px-6 py-12 text-center text-lg text-slate-900">
                    No customers match this search or filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {customers.length > 0 ? (
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
      ) : null}
    </div>
  );
}
