"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Clock, Search, X } from "lucide-react";
import { queueHousekeepingPhotoForDispute } from "@/lib/dispute-photo-transfer";

type PhotoPhase = "pre" | "post";

type InspectionPhoto = {
  id: string;
  phase: PhotoPhase;
  caption: string;
  takenAt: string;
  url: string;
  damage?: boolean;
};

type TurnoverStatus = "checked_out" | "in_progress" | "inspected" | "ready";

type PropertyTurnover = {
  id: string;
  property: string;
  propertyId: string;
  unit: string;
  city: string;
  status: TurnoverStatus;
  window: string;
  assignee: string;
  notes: string;
  photos: InspectionPhoto[];
};

const PROPERTIES: PropertyTurnover[] = [
  {
    id: "hk-ocean",
    property: "Ocean Drive Loft",
    propertyId: "prop-1",
    unit: "2B",
    city: "Miami Beach",
    status: "in_progress",
    window: "Today · 11:00 AM – 3:00 PM",
    assignee: "Marisol Clean Co.",
    notes: "Same-day checkout / check-in. Linen set B, restock coffee.",
    photos: [
      {
        id: "ocean-pre-1",
        phase: "pre",
        caption: "Living room — wine stain on sofa (checkout condition)",
        takenAt: "Aug 29, 2026 · 10:42 AM",
        url: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1600&q=80",
        damage: true,
      },
      {
        id: "ocean-pre-2",
        phase: "pre",
        caption: "Kitchen — leftover food and chipped cabinet edge",
        takenAt: "Aug 29, 2026 · 10:44 AM",
        url: "https://images.unsplash.com/photo-1556912173-46c336c7fd55?auto=format&fit=crop&w=1600&q=80",
        damage: true,
      },
      {
        id: "ocean-pre-3",
        phase: "pre",
        caption: "Bedroom — stripped linens and scuff on nightstand",
        takenAt: "Aug 29, 2026 · 10:47 AM",
        url: "https://images.unsplash.com/photo-1522771739844-6a35a0d0430d?auto=format&fit=crop&w=1600&q=80",
        damage: true,
      },
      {
        id: "ocean-post-1",
        phase: "post",
        caption: "Master bed — turn-ready linens",
        takenAt: "Aug 29, 2026 · 1:18 PM",
        url: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1600&q=80",
      },
      {
        id: "ocean-post-2",
        phase: "post",
        caption: "Bathroom — grout, glass, and amenities reset",
        takenAt: "Aug 29, 2026 · 1:22 PM",
        url: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1600&q=80",
      },
      {
        id: "ocean-post-3",
        phase: "post",
        caption: "Kitchen — appliances and counters turn-ready",
        takenAt: "Aug 29, 2026 · 1:26 PM",
        url: "https://images.unsplash.com/photo-1556911220-bff31f812aa7?auto=format&fit=crop&w=1600&q=80",
      },
    ],
  },
  {
    id: "hk-brickell",
    property: "Brickell Skyline Retreat",
    propertyId: "prop-2",
    unit: "4108",
    city: "Brickell",
    status: "inspected",
    window: "Photos reviewed · 1:45 PM",
    assignee: "Javier (host)",
    notes: "Photo walkthrough after last guest. HVAC filter check complete.",
    photos: [
      {
        id: "brickell-pre-1",
        phase: "pre",
        caption: "Entry — checkout clutter before owner walkthrough",
        takenAt: "Aug 29, 2026 · 12:58 PM",
        url: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=80",
      },
      {
        id: "brickell-pre-2",
        phase: "pre",
        caption: "Living area — wall mark near TV console",
        takenAt: "Aug 29, 2026 · 1:02 PM",
        url: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1600&q=80",
        damage: true,
      },
      {
        id: "brickell-post-1",
        phase: "post",
        caption: "Living room staged after inspection",
        takenAt: "Aug 29, 2026 · 1:45 PM",
        url: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1600&q=80",
      },
      {
        id: "brickell-post-2",
        phase: "post",
        caption: "Bathroom turn-ready after inspection",
        takenAt: "Aug 29, 2026 · 1:47 PM",
        url: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=1600&q=80",
      },
    ],
  },
  {
    id: "hk-gables",
    property: "Coral Gables Cottage",
    propertyId: "prop-3",
    unit: "Main",
    city: "Coral Gables",
    status: "ready",
    window: "Next guest · 4:00 PM",
    assignee: "Sunshine Turnovers",
    notes: "Deep clean finished. Oven, grout, and garage fridge cleared.",
    photos: [
      {
        id: "gables-post-1",
        phase: "post",
        caption: "Cottage bedroom — linens and staging complete",
        takenAt: "Aug 29, 2026 · 9:12 AM",
        url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1600&q=80",
      },
      {
        id: "gables-post-2",
        phase: "post",
        caption: "Kitchen — turn-ready after deep clean",
        takenAt: "Aug 29, 2026 · 9:18 AM",
        url: "https://images.unsplash.com/photo-1556911220-e15b0be8c7d0?auto=format&fit=crop&w=1600&q=80",
      },
    ],
  },
  {
    id: "hk-wynwood",
    property: "Wynwood Studio",
    propertyId: "prop-4",
    unit: "A",
    city: "Wynwood",
    status: "ready",
    window: "Mid-stay complete · Sep 2",
    assignee: "Marisol Clean Co.",
    notes: "Trash and towels restocked. Guest opted in to mid-stay service.",
    photos: [
      {
        id: "wynwood-post-1",
        phase: "post",
        caption: "Studio bath restock after mid-stay service",
        takenAt: "Sep 2, 2026 · 1:41 PM",
        url: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1600&q=80",
      },
    ],
  },
  {
    id: "hk-lauderdale",
    property: "Fort Lauderdale Villa",
    propertyId: "prop-5",
    unit: "Villa",
    city: "Fort Lauderdale",
    status: "checked_out",
    window: "Guest departed · 10:00 AM",
    assignee: "Sunshine Turnovers",
    notes: "Guest departed. Property is ready for cleaning and inspection.",
    photos: [],
  },
  {
    id: "hk-sunny",
    property: "Sunny Isles Penthouse",
    propertyId: "prop-6",
    unit: "PH-12",
    city: "Sunny Isles",
    status: "inspected",
    window: "Verified · 11:20 AM",
    assignee: "Javier (host)",
    notes: "Owner inspection after checkout.",
    photos: [],
  },
  {
    id: "hk-key",
    property: "Key Biscayne Condo",
    propertyId: "prop-7",
    unit: "8C",
    city: "Key Biscayne",
    status: "ready",
    window: "Next guest · 3:00 PM",
    assignee: "Marisol Clean Co.",
    notes: "Turn-ready. Beach towels restocked.",
    photos: [],
  },
  {
    id: "hk-havana",
    property: "Little Havana Walk-up",
    propertyId: "prop-8",
    unit: "1",
    city: "Little Havana",
    status: "checked_out",
    window: "Guest departed · 12:15 PM",
    assignee: "Sunshine Turnovers",
    notes: "Checkout complete. Waiting on housekeeper to start the turn.",
    photos: [],
  },
];

type StatusTab = "all" | TurnoverStatus;

const STATUS_META: Record<TurnoverStatus, { label: string; className: string }> = {
  checked_out: {
    label: "Guest Checked Out",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  in_progress: {
    label: "Turnover in Progress",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  inspected: {
    label: "Inspected & Verified",
    className: "border-purple-200 bg-purple-50 text-purple-700",
  },
  ready: {
    label: "Ready for Check-in",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

const STATUS_TABS: { id: StatusTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready for Check-in" },
  { id: "checked_out", label: "Guest Checked Out" },
  { id: "in_progress", label: "Turnover in Progress" },
  { id: "inspected", label: "Inspected" },
];

export function HousekeepingPanel() {
  const router = useRouter();
  const galleryTitleId = useId();
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [preview, setPreview] = useState<InspectionPhoto | null>(null);
  const [sentPhotoIds, setSentPhotoIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");

  const gallery = PROPERTIES.find((row) => row.id === galleryId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PROPERTIES.filter((row) => {
      if (statusTab !== "all" && row.status !== statusTab) return false;
      if (!needle) return true;
      const haystack = `${row.property} ${row.city} ${row.unit} ${STATUS_META[row.status].label} ${row.window}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, statusTab]);

  useEffect(() => {
    if (!gallery) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (preview) setPreview(null);
      else setGalleryId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gallery, preview]);

  const sendToDossier = (row: PropertyTurnover, photo: InspectionPhoto) => {
    queueHousekeepingPhotoForDispute({
      inspectionId: row.id,
      property: row.property,
      unit: row.unit,
      propertyId: row.propertyId,
      photoId: photo.id,
      caption: photo.caption,
      takenAt: photo.takenAt,
      url: photo.url,
    });
    setSentPhotoIds((prev) => (prev.includes(photo.id) ? prev : [...prev, photo.id]));
    router.push("/dashboard/dispute-dossier");
  };

  return (
    <div data-tour="housekeeping">
      <div className="sticky top-0 z-20 mb-6 border-b border-slate-200 bg-slate-50/95 pb-4 pt-2 backdrop-blur-sm">
        <h2 className="text-lg font-bold text-slate-900">Property Turnovers</h2>
        <p className="mt-1 text-sm font-medium text-slate-800">
          {filtered.length} of {PROPERTIES.length} listings
        </p>
        <Link
          href="/housekeeping/upload"
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"
        >
          <Camera className="h-3.5 w-3.5" />
          Staff camera upload
        </Link>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by property name or status..."
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const active = statusTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusTab(tab.id)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold ${
                  active
                    ? "border-sky-700 bg-sky-600 text-white"
                    : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-900">
          No properties match this search or status filter.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => (
            <article key={row.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-start justify-between gap-2 border-b border-slate-200 bg-slate-100 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-slate-900">{row.property}</h3>
                  <p className="mt-0.5 truncate text-xs font-semibold text-slate-800">
                    {row.city} · Unit {row.unit}
                  </p>
                </div>
                <span className={`max-w-[9.5rem] shrink-0 rounded-full border px-2 py-1 text-center text-[10px] font-bold leading-tight ${STATUS_META[row.status].className}`}>
                  {STATUS_META[row.status].label}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <p className="text-sm font-semibold text-slate-900">{row.window}</p>
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setGalleryId(row.id);
                  }}
                  className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2.5 text-center text-xs font-bold leading-snug text-white hover:bg-sky-700 sm:text-sm"
                >
                  <Camera className="h-4 w-4 shrink-0" />
                  📸 View Photos (Pre-Checkin & Post-Checkout)
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {gallery ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          onClick={() => {
            setPreview(null);
            setGalleryId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={galleryTitleId}
            className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 rounded-t-2xl border-b border-slate-200 bg-slate-100 px-6 py-4">
              <div>
                <h2 id={galleryTitleId} className="text-xl font-bold text-slate-900">
                  {gallery.property}
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  Unit {gallery.unit} · {STATUS_META[gallery.status].label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setGalleryId(null);
                }}
                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-900 hover:bg-slate-50"
                aria-label="Close gallery"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {gallery.photos.length === 0 ? (
              <p className="m-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-base font-semibold text-slate-900">
                No photos submitted yet for this turnover session.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
                <PhotoSection
                  title="Section A: Pre-Cleaning / Check-out Condition"
                  subtitle="Damage inspection & initial state"
                  photos={gallery.photos.filter((photo) => photo.phase === "pre")}
                  sentPhotoIds={sentPhotoIds}
                  onPreview={setPreview}
                  onSendToDossier={(photo) => sendToDossier(gallery, photo)}
                  allowDispute
                />
                <PhotoSection
                  title="Section B: Post-Cleaning / Turn-Ready"
                  subtitle="Made beds, pristine bathrooms, kitchen, staging"
                  photos={gallery.photos.filter((photo) => photo.phase === "post")}
                  sentPhotoIds={sentPhotoIds}
                  onPreview={setPreview}
                />
              </div>
            )}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-slate-900">{preview.caption}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Clock className="h-3.5 w-3.5" /> {preview.takenAt}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg border border-slate-300 p-1.5 text-slate-900 hover:bg-slate-100"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={preview.caption} className="max-h-[72vh] w-full rounded-xl object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PhotoSection({
  title,
  subtitle,
  photos,
  sentPhotoIds,
  onPreview,
  onSendToDossier,
  allowDispute = false,
}: {
  title: string;
  subtitle: string;
  photos: InspectionPhoto[];
  sentPhotoIds: string[];
  onPreview: (photo: InspectionPhoto) => void;
  onSendToDossier?: (photo: InspectionPhoto) => void;
  allowDispute?: boolean;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs font-medium text-slate-800">{subtitle}</p>
      </div>
      {photos.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm font-semibold text-slate-900">
          No photos submitted yet for this turnover session.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4">
          {photos.map((photo) => {
            const sent = sentPhotoIds.includes(photo.id);
            const showDispute = allowDispute && Boolean(photo.damage) && onSendToDossier;
            return (
              <figure key={photo.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button type="button" className="block w-full" onClick={() => onPreview(photo)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${photo.url}&h=360`} alt={photo.caption} className="h-36 w-full object-cover" />
                </button>
                <figcaption className="space-y-2 p-3">
                  <p className="text-xs font-semibold leading-snug text-slate-900">{photo.caption}</p>
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-900">
                    <Clock className="h-3 w-3" /> {photo.takenAt}
                  </p>
                  {showDispute ? (
                    <button
                      type="button"
                      onClick={() => onSendToDossier(photo)}
                      disabled={sent}
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-bold text-slate-900 hover:bg-amber-100 disabled:cursor-default disabled:opacity-70"
                    >
                      {sent ? "Sent to Dispute Dossier" : "⚠️ Send to Dispute Dossier"}
                    </button>
                  ) : null}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}
