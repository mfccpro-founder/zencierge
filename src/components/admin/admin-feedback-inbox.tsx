"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  FEATURE_CATEGORIES,
  FEATURE_STATUSES,
  categoryLabel,
  type FeatureCategoryId,
  type FeatureRequestStatus,
  type HostFeatureRequest,
} from "@/lib/host-feature-requests";

const STATUS_STYLE: Record<FeatureRequestStatus, string> = {
  under_review: "border-amber-800 bg-amber-600 text-white",
  planned: "border-sky-800 bg-sky-700 text-white",
  in_progress: "border-indigo-800 bg-indigo-700 text-white",
  completed: "border-emerald-800 bg-emerald-700 text-white",
};

export function AdminFeedbackInbox() {
  const [rows, setRows] = useState<HostFeatureRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | FeatureCategoryId>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | FeatureRequestStatus>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/feature-requests");
      const data = (await res.json()) as { requests?: HostFeatureRequest[]; error?: string };
      setRows(data.requests ?? []);
      setError(data.error ?? null);
    } catch {
      setError("Failed to load feature requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        return true;
      }),
    [rows, categoryFilter, statusFilter],
  );

  const updateStatus = async (id: string, status: FeatureRequestStatus) => {
    setSavingId(id);
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)));
    try {
      const res = await fetch("/api/admin/feature-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Update failed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed.");
      await load();
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-base text-slate-700">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading feature requests…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">{error}</div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
              statusFilter === "all" ? "border-slate-800 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"
            }`}
          >
            All statuses
          </button>
          {FEATURE_STATUSES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStatusFilter(item.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                statusFilter === item.id ? "border-slate-800 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
              categoryFilter === "all" ? "border-slate-800 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"
            }`}
          >
            All categories
          </button>
          {FEATURE_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategoryFilter(item.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                categoryFilter === item.id ? "border-slate-800 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[650px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left text-base">
          <thead className="sticky top-0 z-10 bg-slate-100/95 text-sm font-semibold uppercase tracking-wide text-slate-900 shadow-xs backdrop-blur-sm">
            <tr>
              {["Date", "Host Email", "Category", "Title & Details", "Status"].map((label) => (
                <th
                  key={label}
                  className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100/95 px-5 py-4 text-slate-900"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="align-top hover:bg-slate-50">
                <td className="whitespace-nowrap border-b border-slate-300 px-5 py-4 text-slate-900">
                  {new Date(row.createdAt).toLocaleString("en-US")}
                </td>
                <td className="border-b border-slate-300 px-5 py-4 font-medium text-slate-900">{row.hostEmail || "—"}</td>
                <td className="border-b border-slate-300 px-5 py-4">
                  <span className="inline-block rounded-full border border-slate-800 bg-slate-800 px-3 py-1 text-xs font-bold text-white">
                    {categoryLabel(row.category)}
                  </span>
                </td>
                <td className="border-b border-slate-300 px-5 py-4">
                  <p className="font-semibold text-slate-900">{row.title}</p>
                  <p className="mt-1 text-sm text-slate-800">{row.description}</p>
                </td>
                <td className="border-b border-slate-300 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <select
                      value={row.status}
                      disabled={savingId === row.id}
                      onChange={(event) => void updateStatus(row.id, event.target.value as FeatureRequestStatus)}
                      className={`rounded-lg border px-3 py-2 text-sm font-bold ${STATUS_STYLE[row.status]}`}
                    >
                      {FEATURE_STATUSES.map((item) => (
                        <option key={item.id} value={item.id} className="bg-white text-slate-900">
                          {item.label}
                        </option>
                      ))}
                    </select>
                    {savingId === row.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-700" /> : null}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="border-b border-slate-300 px-5 py-12 text-center text-lg text-slate-900">
                  No feature requests match these filters. They appear here after a host submits “Request a Feature”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
