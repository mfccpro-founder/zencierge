"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BUSINESS_EXPENSE_CATEGORIES,
  BUSINESS_EXPENSE_CATEGORY_LABELS,
  formatExpenseUsd,
  type BusinessExpenseCategory,
  type BusinessExpenseRow,
} from "@/lib/admin-expenses-shared";

type Draft = {
  expenseDate: string;
  category: BusinessExpenseCategory;
  vendor: string;
  description: string;
  amountUsd: string;
  recurring: boolean;
  recurrenceNote: string;
};

function emptyDraft(todayIsoDate: string): Draft {
  return {
    expenseDate: todayIsoDate,
    category: "payroll",
    vendor: "",
    description: "",
    amountUsd: "",
    recurring: false,
    recurrenceNote: "",
  };
}

function rowToDraft(row: BusinessExpenseRow): Draft {
  return {
    expenseDate: row.expenseDate,
    category: row.category,
    vendor: row.vendor,
    description: row.description,
    amountUsd: String(row.amountUsd),
    recurring: row.recurring,
    recurrenceNote: row.recurrenceNote ?? "",
  };
}

export function BackOfficeExpensesPanel(input: {
  expenses: BusinessExpenseRow[];
  todayIsoDate: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(input.todayIsoDate));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const title = useMemo(() => (editingId ? "Edit expense" : "Add expense"), [editingId]);

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft(input.todayIsoDate));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        id: editingId ?? undefined,
        expenseDate: draft.expenseDate,
        category: draft.category,
        vendor: draft.vendor,
        description: draft.description,
        amountUsd: draft.amountUsd,
        recurring: draft.recurring,
        recurrenceNote: draft.recurrenceNote,
      };
      const response = await fetch("/api/backoffice/expenses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setMessage(editingId ? "Expense updated." : "Expense added.");
      resetForm();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: BusinessExpenseRow) {
    if (!window.confirm(`Delete expense for ${row.vendor} (${formatExpenseUsd(row.amountUsd)})?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/backoffice/expenses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Delete failed");
        return;
      }
      if (editingId === row.id) resetForm();
      setMessage("Expense deleted.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Manual Zencierge company ledger only. Do not enter Isabela/OpenAI/ElevenLabs TTS here — AI COGS come from
          Isabela Usage.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">
            Expense date
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={draft.expenseDate}
              onChange={(event) => setDraft((current) => ({ ...current, expenseDate: event.target.value }))}
            />
          </label>
          <label className="text-sm text-slate-700">
            Category
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={draft.category}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  category: event.target.value as BusinessExpenseCategory,
                }))
              }
            >
              {BUSINESS_EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {BUSINESS_EXPENSE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700 sm:col-span-2">
            Vendor / Person
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={draft.vendor}
              onChange={(event) => setDraft((current) => ({ ...current, vendor: event.target.value }))}
              placeholder="Name or company"
            />
          </label>
          <label className="text-sm text-slate-700 sm:col-span-2">
            Description
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="Optional note"
            />
          </label>
          <label className="text-sm text-slate-700">
            Amount (USD)
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={draft.amountUsd}
              onChange={(event) => setDraft((current) => ({ ...current, amountUsd: event.target.value }))}
            />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.recurring}
              onChange={(event) => setDraft((current) => ({ ...current, recurring: event.target.checked }))}
            />
            Recurring (flag only — no auto-posting)
          </label>
          {draft.recurring ? (
            <label className="text-sm text-slate-700 sm:col-span-2">
              Recurrence note
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={draft.recurrenceNote}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, recurrenceNote: event.target.value }))
                }
                placeholder="e.g. monthly"
              />
            </label>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {editingId ? "Save changes" : "Add expense"}
          </button>
          {editingId ? (
            <button
              type="button"
              disabled={busy}
              onClick={resetForm}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-red-700">{error}</p> : null}
        {message ? <p className="mt-3 text-sm font-medium text-emerald-800">{message}</p> : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Expenses this month</h2>
        <p className="mt-1 text-xs text-slate-500">Manual ledger rows only</p>
        {input.expenses.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No manual expenses recorded for this month yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Vendor / Person</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 font-semibold">Amount</th>
                  <th className="px-3 py-2 font-semibold">Recurring</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {input.expenses.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 text-slate-800">
                    <td className="whitespace-nowrap px-3 py-2">{row.expenseDate}</td>
                    <td className="px-3 py-2">{row.categoryLabel}</td>
                    <td className="px-3 py-2">{row.vendor}</td>
                    <td className="px-3 py-2 text-slate-600">{row.description || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {formatExpenseUsd(row.amountUsd)}
                    </td>
                    <td className="px-3 py-2">
                      {row.recurring ? row.recurrenceNote || "Yes" : "No"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="text-xs font-semibold text-slate-800 underline"
                          onClick={() => {
                            setEditingId(row.id);
                            setDraft(rowToDraft(row));
                            setMessage(null);
                            setError(null);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="text-xs font-semibold text-red-700 underline"
                          onClick={() => void remove(row)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
