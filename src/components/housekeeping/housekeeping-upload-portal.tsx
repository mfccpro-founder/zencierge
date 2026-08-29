"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import {
  HOUSEKEEPING_PHOTO_CATEGORIES,
  parseHousekeepingPhotoCategory,
  type HousekeepingPhotoCategory,
} from "@/lib/housekeeping-photos";

type PropertyOption = { id: string; name: string; city: string };
type ReservationOption = {
  id: string;
  propertyId: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  status: string;
};

export function HousekeepingUploadPortal() {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [reservations, setReservations] = useState<ReservationOption[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [category, setCategory] = useState<HousekeepingPhotoCategory>("check_out");
  const [staffName, setStaffName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/housekeeping/options");
        const data = (await response.json()) as {
          properties?: PropertyOption[];
          reservations?: ReservationOption[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Could not load properties.");
        const nextProperties = data.properties ?? [];
        setProperties(nextProperties);
        setReservations(data.reservations ?? []);
        setPropertyId((current) => current || nextProperties[0]?.id || "");
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : "Could not load properties.");
      }
    })();
  }, []);

  const stayOptions = useMemo(
    () => reservations.filter((row) => row.propertyId === propertyId),
    [reservations, propertyId],
  );

  useEffect(() => {
    if (!stayOptions.some((row) => row.id === reservationId)) {
      setReservationId(stayOptions[0]?.id ?? "");
    }
  }, [stayOptions, reservationId]);

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
    setFiles((current) => [...current, ...Array.from(list)]);
    setError(null);
    setNotice(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!propertyId || !reservationId) {
      setError("Select a property and reservation.");
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
      body.set("reservationId", reservationId);
      body.set("category", category);
      if (staffName.trim()) body.set("staffName", staffName.trim());
      for (const file of files) body.append("files", file);

      const response = await fetch("/api/housekeeping/upload", { method: "POST", body });
      const data = (await response.json()) as { error?: string; count?: number };
      if (!response.ok) throw new Error(data.error ?? "Upload failed.");
      setNotice(`${data.count ?? files.length} photo(s) saved to the listing vault.`);
      setFiles([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-emerald-500";

  return (
    <form onSubmit={(event) => void submit(event)} className="mx-auto w-full max-w-lg space-y-5 px-4 py-6 pb-10">
      <header className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Cleaning staff</p>
        <h1 className="text-2xl font-black tracking-tight text-slate-950">Photo upload</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          Capture check-in, check-out, or damage photos. They save to this reservation&apos;s housekeeping folder.
        </p>
      </header>

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

      <label className="block text-sm font-semibold text-slate-700">
        Reservation
        <select
          required
          className={fieldClass}
          value={reservationId}
          onChange={(event) => setReservationId(event.target.value)}
          disabled={!stayOptions.length}
        >
          {stayOptions.length ? (
            stayOptions.map((stay) => (
              <option key={stay.id} value={stay.id}>
                {stay.guest} · {stay.checkIn} → {stay.checkOut} ({stay.status})
              </option>
            ))
          ) : (
            <option value="">No active reservations</option>
          )}
        </select>
      </label>

      <fieldset>
        <legend className="text-sm font-semibold text-slate-700">Photo category</legend>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {HOUSEKEEPING_PHOTO_CATEGORIES.map((option) => {
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
                  name="category"
                  value={option.id}
                  checked={active}
                  onChange={(event) => {
                    const next = parseHousekeepingPhotoCategory(event.target.value);
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-50 px-4 py-5 text-center text-sm font-bold text-emerald-950">
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
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm font-bold text-slate-800">
          <ImagePlus className="h-8 w-8" />
          Choose from library
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
          {previews.map((preview) => (
            <li key={preview.url} className="overflow-hidden rounded-xl bg-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt={preview.name} className="h-24 w-full object-cover" />
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
        className="flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-black text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {busy ? "Uploading…" : "Upload photos"}
      </button>
    </form>
  );
}
