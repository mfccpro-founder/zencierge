"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocalGuideCategory } from "@/lib/local-guide-shared";
import { LOCAL_GUIDE_CATEGORIES } from "@/lib/local-guide-shared";
import type { LocalGuideHostRow } from "@/lib/local-guide-shared";

const emptyForm = {
  category: "restaurant" as LocalGuideCategory,
  businessName: "",
  distanceMiles: "",
  hostNote: "",
  websiteOrMapsLink: "",
  active: true,
  sortOrder: "0",
};

export function PropertyLocalGuidePanel({ propertyId }: { propertyId: string }) {
  const [rows, setRows] = useState<LocalGuideHostRow[]>([]);
  const [setupRequired, setSetupRequired] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    const response = await fetch(`/api/local-guide?propertyId=${encodeURIComponent(propertyId)}`);
    const data = (await response.json().catch(() => ({}))) as {
      rows?: LocalGuideHostRow[];
      setupRequired?: boolean;
      error?: string;
    };
    if (response.status === 401) {
      setError("Sign in to manage Local Guide.");
      return;
    }
    if (data.setupRequired || response.status === 503) {
      setSetupRequired(true);
      setRows([]);
      return;
    }
    setSetupRequired(false);
    setError("");
    setRows(Array.isArray(data.rows) ? data.rows : []);
  }, [propertyId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/local-guide?propertyId=${encodeURIComponent(propertyId)}`);
      const data = (await response.json().catch(() => ({}))) as {
        rows?: LocalGuideHostRow[];
        setupRequired?: boolean;
        error?: string;
      };
      if (cancelled) return;
      if (response.status === 401) {
        setError("Sign in to manage Local Guide.");
        return;
      }
      if (data.setupRequired || response.status === 503) {
        setSetupRequired(true);
        setRows([]);
        return;
      }
      setSetupRequired(false);
      setError("");
      setRows(Array.isArray(data.rows) ? data.rows : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const submit = async () => {
    setSaving(true);
    setError("");
    const payload = {
      propertyId,
      category: form.category,
      businessName: form.businessName,
      distanceMiles: form.distanceMiles === "" ? null : Number(form.distanceMiles),
      hostNote: form.hostNote,
      websiteOrMapsLink: form.websiteOrMapsLink,
      active: form.active,
      sortOrder: Number(form.sortOrder) || 0,
      ...(editingId ? { id: editingId } : {}),
    };
    const response = await fetch("/api/local-guide", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as { setupRequired?: boolean; error?: string };
    setSaving(false);
    if (data.setupRequired || response.status === 503) {
      setSetupRequired(true);
      return;
    }
    if (!response.ok) {
      setError("Could not save that recommendation. Check the name, category, and link.");
      return;
    }
    resetForm();
    await load();
  };

  const remove = async (id: string) => {
    setSaving(true);
    const response = await fetch("/api/local-guide", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, propertyId }),
    });
    setSaving(false);
    if (response.status === 503) {
      setSetupRequired(true);
      return;
    }
    if (!response.ok) {
      setError("Could not delete that recommendation.");
      return;
    }
    await load();
  };

  if (setupRequired) {
    return (
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-800">Local Guide</h4>
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-950">
          Local Guide is not set up on this workspace yet. Recommendations will stay off until the host database
          update is applied. The rest of this listing still works.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-800">Local Guide</h4>
      <p className="text-[11px] text-slate-600">
        Host picks Elena can name out loud. These are not Google results.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-[12px] text-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                {row.businessName}{" "}
                <span className="font-normal text-slate-500">
                  · {row.category}
                  {row.distanceMiles != null ? ` · ${row.distanceMiles} mi` : ""}
                  {row.active ? "" : " · inactive"}
                </span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-sky-800"
                  onClick={() => {
                    setEditingId(row.id);
                    setForm({
                      category: row.category,
                      businessName: row.businessName,
                      distanceMiles: row.distanceMiles == null ? "" : String(row.distanceMiles),
                      hostNote: row.hostNote,
                      websiteOrMapsLink: row.websiteOrMapsLink,
                      active: row.active,
                      sortOrder: String(row.sortOrder),
                    });
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded-md border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700"
                  onClick={() => void remove(row.id)}
                >
                  Delete
                </button>
              </div>
            </div>
            {row.hostNote ? <p className="mt-1 text-slate-600">{row.hostNote}</p> : null}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-sky-200 bg-white p-3 sm:grid-cols-2">
        <label className="text-[11px] font-medium text-slate-600">
          Category
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={form.category}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as LocalGuideCategory }))}
          >
            {LOCAL_GUIDE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-medium text-slate-600">
          Business name
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={form.businessName}
            onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}
          />
        </label>
        <label className="text-[11px] font-medium text-slate-600">
          Miles (optional)
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            inputMode="decimal"
            value={form.distanceMiles}
            onChange={(event) => setForm((current) => ({ ...current, distanceMiles: event.target.value }))}
          />
        </label>
        <label className="text-[11px] font-medium text-slate-600">
          Display order
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={form.sortOrder}
            onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
          />
        </label>
        <label className="text-[11px] font-medium text-slate-600 sm:col-span-2">
          Note (optional)
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={form.hostNote}
            onChange={(event) => setForm((current) => ({ ...current, hostNote: event.target.value }))}
          />
        </label>
        <label className="text-[11px] font-medium text-slate-600 sm:col-span-2">
          Website or Maps link (optional)
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            value={form.websiteOrMapsLink}
            onChange={(event) => setForm((current) => ({ ...current, websiteOrMapsLink: event.target.value }))}
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
          />
          Active
        </label>
        <div className="flex gap-2 sm:justify-end">
          {editingId ? (
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold" onClick={resetForm}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-sky-700 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            onClick={() => void submit()}
          >
            {editingId ? "Save" : "Add"}
          </button>
        </div>
      </div>
      {error ? <p className="text-[11px] text-rose-700">{error}</p> : null}
    </section>
  );
}
