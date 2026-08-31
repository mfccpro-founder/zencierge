"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";
import {
  HOUSEKEEPING_REPORT_CATEGORIES,
  parseHousekeepingReportCategory,
  type HousekeepingReportCategory,
} from "@/lib/housekeeping-photos";
import { guestPressClass } from "@/lib/guest-press";

type PropertyOption = { id: string; name: string; city: string };

export function HousekeepingPhotoReportForm({
  lockPropertyId,
  compact,
  onDone,
}: {
  lockPropertyId?: string;
  compact?: boolean;
  onDone?: () => void;
}) {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState(lockPropertyId ?? "");
  const [category, setCategory] = useState<HousekeepingReportCategory>("cleaned_ready");
  const [staffName, setStaffName] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/housekeeping/options");
        const data = (await response.json()) as { properties?: PropertyOption[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not load properties.");
        const next = data.properties ?? [];
        setProperties(next);
        setPropertyId((current) => lockPropertyId || current || next[0]?.id || "");
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : "Could not load properties.");
      }
    })();
  }, [lockPropertyId]);

  const previews = useMemo(
    () => files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [files],
  );

  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previews]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((current) => [...current, ...Array.from(list)].slice(0, 12));
    setError(null);
    setNotice(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!propertyId) {
      setError("Select a property.");
      return;
    }
    if (!files.length) {
      setError("Take or attach at least one photo.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("propertyId", propertyId);
      body.set("category", category);
      if (staffName.trim()) body.set("staffName", staffName.trim());
      if (notes.trim()) body.set("notes", notes.trim());
      for (const file of files) body.append("files", file);
      const response = await fetch("/api/housekeeping/reports", { method: "POST", body });
      const data = (await response.json()) as { error?: string; count?: number };
      if (!response.ok) throw new Error(data.error ?? "Could not send the report.");
      setNotice(`Report sent to the host (${data.count ?? files.length} photo${(data.count ?? files.length) === 1 ? "" : "s"}).`);
      setFiles([]);
      setNotes("");
      onDone?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the report.");
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-emerald-500";

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {!compact ? (
        <header className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Housekeeping photo report</p>
          <h2 className="text-xl font-black tracking-tight text-slate-950">Send photos to the host</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Choose a status, add photos from your camera or gallery, and include a short note. The host is notified right away.
          </p>
        </header>
      ) : null}

      {loadError ? <p className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadError}</p> : null}

      <label className="block text-sm font-semibold text-slate-700">
        Your name
        <input
          className={fieldClass}
          value={staffName}
          onChange={(event) => setStaffName(event.target.value)}
          placeholder="Optional"
          autoComplete="name"
        />
      </label>

      {lockPropertyId ? null : (
        <label className="block text-sm font-semibold text-slate-700">
          Property
          <select
            required
            className={fieldClass}
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name} · {property.city}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-slate-700">Status</legend>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {HOUSEKEEPING_REPORT_CATEGORIES.map((option) => {
            const active = category === option.id;
            return (
              <label
                key={option.id}
                className={`flex min-h-12 items-center gap-3 rounded-2xl border px-4 py-3 text-base font-semibold ${
                  active ? "border-emerald-500 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-800"
                }`}
              >
                <input
                  type="radio"
                  name="hk-report-category"
                  value={option.id}
                  checked={active}
                  onChange={(event) => {
                    const next = parseHousekeepingReportCategory(event.target.value);
                    if (next) setCategory(next);
                  }}
                  className="h-4 w-4 accent-emerald-600"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="block text-sm font-semibold text-slate-700">
        Short description
        <textarea
          className={`${fieldClass} min-h-24 resize-y`}
          value={notes}
          maxLength={800}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Example: Unit is guest-ready. Trash bags restocked. One cracked tile in hall bath."
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={`${guestPressClass} flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-50 px-4 py-5 text-center text-sm font-bold text-emerald-950`}>
          <Camera className="h-8 w-8" />
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className={`${guestPressClass} flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm font-bold text-slate-800`}>
          <ImagePlus className="h-8 w-8" />
          Choose from gallery
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {previews.length ? (
        <ul className="grid grid-cols-3 gap-2">
          {previews.map((preview, index) => (
            <li key={preview.url} className="relative overflow-hidden rounded-xl bg-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt={preview.name} className="h-24 w-full object-cover" />
              <button
                type="button"
                className="absolute right-1 top-1 rounded-full bg-slate-950/70 p-1 text-white"
                aria-label="Remove photo"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
      {notice ? (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className={`${guestPressClass} flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-black text-white hover:bg-emerald-500 disabled:opacity-60`}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {busy ? "Sending report…" : "Send photo report"}
      </button>
    </form>
  );
}

export function HousekeepingPhotoReportModal({
  open,
  onClose,
  lockPropertyId,
}: {
  open: boolean;
  onClose: () => void;
  lockPropertyId?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-950/50" aria-label="Close photo report" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hk-photo-report-title"
        className="relative z-10 max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-xl sm:rounded-3xl sm:p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="hk-photo-report-title" className="text-lg font-bold text-slate-900">
            Housekeeping photo report
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 p-2 text-slate-700" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <HousekeepingPhotoReportForm lockPropertyId={lockPropertyId} compact onDone={onClose} />
      </div>
    </div>
  );
}
