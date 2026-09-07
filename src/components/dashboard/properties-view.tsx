"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Battery,
  Building2,
  Car,
  Clock,
  Copy,
  Check,
  History,
  KeyRound,
  MapPin,
  Plus,
  Search,
  Wifi,
  BookOpen,
  ExternalLink,
  X,
  User,
  Sparkles,
  Phone,
} from "lucide-react";
import Link from "next/link";
import {
  propertyCities,
  type Property,
  type PropertyCity,
  type OccupancyStatus,
} from "@/lib/dashboard-data";
import { PropertyLocalGuidePanel } from "@/components/dashboard/property-local-guide-panel";
import { useListings } from "@/components/dashboard/listings-provider";
import { useSubscriptionTier } from "@/hooks/use-subscription-tier";
import { getSupabase } from "@/lib/supabase";
import {
  PROPERTY_AVATAR_NAMES,
  PROPERTY_TIMEZONES,
  defaultAgentConfig,
} from "@/lib/property-agent";

import { SmartLocksView } from "@/components/dashboard/smart-locks-view";
import {
  LOCK_VENDOR_META,
  inferLockVendor,
  lockBatteryPct,
  lockBrandLabel,
  lockStatusFor,
  type LockVendor,
} from "@/lib/smart-locks";

type CityFilter = "all" | PropertyCity;
type OccupancyFilter = "all" | OccupancyStatus;

type ModalMode =
  | { kind: "closed" }
  | { kind: "handbook"; propertyId: string }
  | { kind: "create" };

const emptyDraft: Omit<Property, "id"> = {
  name: "",
  city: "Miami Beach",
  address: "",
  status: "Vacant",
  revenue: "$0",
  doorCode: "",
  smartlock: "",
  wifiNetwork: "",
  wifiPassword: "",
  parking: "",
  gateCode: "",
  checkIn: "3:00 PM",
  checkOut: "11:00 AM",
  currentGuest: null,
  trash: "",
  handbook: "",
  assignedAvatarName: "Elena",
  assignedPhoneNumber: "+1 (305) 555-0199",
  avatarSystemPrompt: defaultAgentConfig("Miami Beach").avatarSystemPrompt,
  timezone: "America/New_York",
};

function CopyField({
  label,
  value,
  copyId,
  copiedId,
  onCopy,
  mono = true,
}: {
  label: string;
  value: string;
  copyId: string;
  copiedId: string | null;
  onCopy: (id: string, value: string) => void;
  mono?: boolean;
}) {
  const copied = copiedId === copyId;

  return (
    <div className="flex min-w-0 items-center justify-between gap-1.5">
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p
          className={`truncate text-[11px] leading-tight text-slate-800 ${mono ? "font-mono" : ""}`}
          title={value || undefined}
        >
          {value || "—"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(copyId, value)}
        disabled={!value || value === "—"}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-sky-200 bg-white text-slate-600 transition-colors hover:bg-sky-50 disabled:pointer-events-none disabled:opacity-40"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

const LOCK_STATUS_LABEL = {
  online: "Online",
  offline: "Offline",
  jammed: "Jammed",
} as const;

function propertyAccessLogs(property: Property) {
  const battery = lockBatteryPct(property.id);
  const status = lockStatusFor(property.smartlock, battery);
  const brand = lockBrandLabel(property.smartlock);
  const guest = property.currentGuest;

  return [
    {
      at: "Today · 3:12 PM",
      event: "Door unlocked",
      detail: guest
        ? `${guest} entered with the guest PIN on ${brand}.`
        : `Seam recorded an unlock on ${brand}.`,
    },
    {
      at: "Today · 10:41 AM",
      event: "Battery check",
      detail: `${brand} reported ${battery}% battery · ${LOCK_STATUS_LABEL[status]}.`,
    },
    {
      at: "Yesterday · 4:02 PM",
      event: "PIN rotated",
      detail: "Guest door PIN was saved to this listing and synced through Seam.",
    },
    {
      at: "Yesterday · 11:18 AM",
      event: "Lock online",
      detail: `${brand} heartbeat received. Front door ready for self check-in.`,
    },
  ];
}

export function PropertiesView() {
  return <PropertiesViewInner />;
}

function PropertiesViewInner() {
  const { properties: listings, saveProperty, applyHandbook, loading, error } = useListings();
  const { canAddProperty, planName, maxProperties, isActive } = useSubscriptionTier();
  const [cityFilter, setCityFilter] = useState<CityFilter>("all");
  const [occupancyFilter, setOccupancyFilter] = useState<OccupancyFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalMode>({ kind: "closed" });
  const [isSmartLockOpen, setIsSmartLockOpen] = useState(false);
  const [smartLocksPropertyId, setSmartLocksPropertyId] = useState<string | undefined>(undefined);
  const [handbookDraft, setHandbookDraft] = useState("");
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingHandbook, setSavingHandbook] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return listings.filter((property) => {
      const cityOk = cityFilter === "all" || property.city === cityFilter;
      const statusOk =
        occupancyFilter === "all" || property.status === occupancyFilter;
      const searchOk =
        !query ||
        property.name.toLowerCase().includes(query) ||
        property.address.toLowerCase().includes(query) ||
        property.city.toLowerCase().includes(query);
      return cityOk && statusOk && searchOk;
    });
  }, [listings, cityFilter, occupancyFilter, searchQuery]);

  const openHandbook = (property: Property) => {
    setHandbookDraft(property.handbook);
    setModal({ kind: "handbook", propertyId: property.id });
  };

  const openCreate = () => {
    if (!canAddProperty) {
      window.alert(
        isActive
          ? `${planName} allows ${Number.isFinite(maxProperties) ? maxProperties : "unlimited"} listings. Change your plan in Settings → Billing & Subscriptions.`
          : "Start a 14-day free trial from the public pricing page, or manage billing in Settings → Billing & Subscriptions.",
      );
      return;
    }
    setCreateDraft(emptyDraft);
    setModal({ kind: "create" });
  };

  const closeModal = () => setModal({ kind: "closed" });

  const handleCloseModal = () => {
    setIsSmartLockOpen(false);
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "smart-locks") {
      return;
    }
    window.history.replaceState(null, "", "/dashboard/properties");
  };

  const openSmartLocks = (propertyId?: string) => {
    setSmartLocksPropertyId(propertyId ?? listings[0]?.id);
    setIsSmartLockOpen(true);
  };

  useEffect(() => {
    if (!isSmartLockOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSmartLockOpen]);

  useEffect(() => {
    if (modal.kind === "closed") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal.kind]);

  useEffect(() => {
    if (!saveToast) return;
    const timer = window.setTimeout(() => setSaveToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [saveToast]);

  const handleSaveHandbook = async () => {
    if (modal.kind !== "handbook") return;
    const selectedPropertyId = modal.propertyId;
    const currentHandbookText = handbookDraft.trim();
    setSavingHandbook(true);
    try {
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("properties")
        .update({ ai_handbook: currentHandbookText })
        .eq("id", selectedPropertyId);

      if (updateError) {
        console.error(updateError);
        window.alert(updateError.message);
        return;
      }

      applyHandbook(selectedPropertyId, currentHandbookText);
      closeModal();
      setSaveToast("Handbook saved");
    } catch (cause) {
      console.error(cause);
      window.alert(cause instanceof Error ? cause.message : "Could not save handbook");
    } finally {
      setSavingHandbook(false);
    }
  };

  const saveNewProperty = () => {
    const name = createDraft.name.trim();
    if (!name) return;

    const next: Property = {
      ...createDraft,
      name,
      address: createDraft.address.trim(),
      doorCode: createDraft.doorCode.trim(),
      smartlock: createDraft.smartlock.trim() || "Smartlock",
      wifiNetwork: createDraft.wifiNetwork.trim(),
      wifiPassword: createDraft.wifiPassword.trim(),
      parking: createDraft.parking.trim(),
      gateCode: createDraft.gateCode.trim() || "—",
      trash: createDraft.trash.trim(),
      handbook: createDraft.handbook.trim(),
      currentGuest:
        createDraft.status === "Occupied"
          ? createDraft.currentGuest?.trim() || "Guest"
          : null,
      id: `prop-${crypto.randomUUID()}`,
    };

    void (async () => {
      try {
        await saveProperty(next);
        closeModal();
      } catch (cause) {
        window.alert(cause instanceof Error ? cause.message : "Could not add property");
      }
    })();
  };

  const handleCopy = async (id: string, value: string) => {
    if (!value || value === "—") return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1600);
    } catch {
      setCopiedId(null);
    }
  };

  const editingProperty =
    modal.kind === "handbook"
      ? listings.find((property) => property.id === modal.propertyId)
      : undefined;

  return (
    <div id="all-properties" className="scroll-mt-28 space-y-4">
      {saveToast ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
        >
          {saveToast}
        </div>
      ) : null}
      <p className="text-[11px] text-slate-500">
        {loading
          ? "Loading properties from Supabase…"
          : "Live from Supabase · Save handbook writes ai_handbook"}
        {error ? ` · ${error}` : ""}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Elena AI · listing knowledge</p>
            <p className="mt-0.5 text-xs text-slate-700">
              Door codes, Wi-Fi, parking, and the AI handbook on each listing are the prompts Elena reads on guest calls.
              Open the voice studio for line, language, and avatar settings.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/voice-agent"
          className="shrink-0 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-bold text-sky-900 hover:bg-sky-100"
        >
          Elena voice settings
        </Link>
      </div>

      <SmartLocksView
        listings={listings}
        onViewPins={(propertyId) => openSmartLocks(propertyId)}
        onLinkLock={() => openSmartLocks()}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Search listings
            </p>
            <label className="relative block max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name, city, or address"
                aria-label="Search properties"
                className="w-full rounded-xl border border-sky-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500"
              />
            </label>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
              Filter by city
            </p>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={cityFilter === "all"}
                onClick={() => setCityFilter("all")}
                label="All cities"
              />
              {propertyCities.map((city) => (
                <FilterChip
                  key={city}
                  active={cityFilter === city}
                  onClick={() => setCityFilter(city)}
                  label={city}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
              Occupancy
            </p>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={occupancyFilter === "all"}
                onClick={() => setOccupancyFilter("all")}
                label="All statuses"
              />
              <FilterChip
                active={occupancyFilter === "Occupied"}
                onClick={() => setOccupancyFilter("Occupied")}
                label="Occupied"
              />
              <FilterChip
                active={occupancyFilter === "Vacant"}
                onClick={() => setOccupancyFilter("Vacant")}
                label="Vacant"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add New Property
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-6 py-10 text-center">
          <Building2 className="mx-auto h-8 w-8 text-sky-400" />
          <p className="mt-3 text-sm font-medium text-slate-800">
            No properties match this filter
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Try another city, occupancy status, or search term.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-600">
            {filtered.length} {filtered.length === 1 ? "listing" : "listings"}
            {filtered.length !== listings.length ? ` of ${listings.length}` : ""}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((property) => {
              const expanded = expandedId === property.id;
              return (
                <article
                  key={property.id}
                  className={`flex h-auto min-h-0 flex-col overflow-hidden rounded-xl border border-sky-200 bg-white shadow-sm transition-[padding,box-shadow] duration-300 ease-out ${
                    expanded
                      ? "p-5 shadow-md md:col-span-2 lg:col-span-3"
                      : "p-4"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-900">
                        {property.name}
                      </h3>
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-600">
                        <MapPin className="h-3 w-3 shrink-0 text-sky-600" />
                        <span className={expanded ? "whitespace-normal" : "truncate"}>
                          {property.city} · {property.address}
                        </span>
                      </p>
                    </div>
                    <OccupancyBadge
                      status={property.status}
                      guest={property.currentGuest}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId((current) => (current === property.id ? null : property.id))
                      }
                      aria-expanded={expanded}
                      className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900 hover:bg-sky-100"
                    >
                      {expanded ? "Close details" : "View details"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openSmartLocks(property.id)}
                      className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-sky-50"
                    >
                      Smart locks
                    </button>
                    <a
                      href={`/guest/${property.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Guest portal
                    </a>
                  </div>

                  <ExpandPanel open={expanded}>
                    <div className="min-h-[22rem] space-y-4 border-t border-sky-100 pt-4">
                      <PropertyDetails
                        property={property}
                        copiedId={copiedId}
                        onCopy={handleCopy}
                        onOpenSmartLocks={() => openSmartLocks(property.id)}
                        onOpenHandbook={() => openHandbook(property)}
                        onSave={saveProperty}
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setExpandedId(null)}
                          className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-sky-50"
                        >
                          Close details
                        </button>
                      </div>
                    </div>
                  </ExpandPanel>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {modal.kind !== "closed" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="property-modal-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-sky-200 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3
                  id="property-modal-title"
                  className="text-base font-semibold text-slate-900"
                >
                  {modal.kind === "create"
                    ? "Add New Property"
                    : `AI Handbook · ${editingProperty?.name ?? ""}`}
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  {modal.kind === "create"
                    ? "New units appear in the knowledge base the voice line uses during calls."
                    : "These instructions are what the AI receptionist reads while on a guest call."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-sky-50 hover:text-slate-900"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {modal.kind === "handbook" ? (
              <div className="space-y-4">
                <textarea
                  value={handbookDraft}
                  onChange={(event) => setHandbookDraft(event.target.value)}
                  rows={10}
                  className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-sky-500"
                  placeholder="Door codes, Wi-Fi, parking, house rules, and what the AI must never authorize..."
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-sky-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveHandbook}
                    disabled={savingHandbook}
                    className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
                  >
                    {savingHandbook ? "Saving…" : "Save handbook"}
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveNewProperty();
                }}
              >
                <Field
                  label="Name"
                  value={createDraft.name}
                  onChange={(value) =>
                    setCreateDraft((draft) => ({ ...draft, name: value }))
                  }
                  required
                  placeholder="e.g. Wynwood Studio"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      City
                    </label>
                    <select
                      value={createDraft.city}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          city: event.target.value as PropertyCity,
                        }))
                      }
                      className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      {propertyCities.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Occupancy
                    </label>
                    <select
                      value={createDraft.status}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          status: event.target.value as OccupancyStatus,
                          currentGuest:
                            event.target.value === "Vacant"
                              ? null
                              : draft.currentGuest,
                        }))
                      }
                      className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="Vacant">Vacant</option>
                      <option value="Occupied">Occupied</option>
                    </select>
                  </div>
                </div>
                <Field
                  label="Address"
                  value={createDraft.address}
                  onChange={(value) =>
                    setCreateDraft((draft) => ({ ...draft, address: value }))
                  }
                  placeholder="Street, unit"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Door code"
                    value={createDraft.doorCode}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({ ...draft, doorCode: value }))
                    }
                    placeholder="4920#"
                  />
                  <Field
                    label="Smartlock"
                    value={createDraft.smartlock}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({ ...draft, smartlock: value }))
                    }
                    placeholder="Yale Assure · Front door"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Wi-Fi network"
                    value={createDraft.wifiNetwork}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({ ...draft, wifiNetwork: value }))
                    }
                  />
                  <Field
                    label="Wi-Fi password"
                    value={createDraft.wifiPassword}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({
                        ...draft,
                        wifiPassword: value,
                      }))
                    }
                  />
                </div>
                <Field
                  label="Parking"
                  value={createDraft.parking}
                  onChange={(value) =>
                    setCreateDraft((draft) => ({ ...draft, parking: value }))
                  }
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Gate code"
                    value={createDraft.gateCode}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({ ...draft, gateCode: value }))
                    }
                    placeholder="1984#"
                  />
                  <Field
                    label="Current guest"
                    value={createDraft.currentGuest ?? ""}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({
                        ...draft,
                        currentGuest: value,
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Check-in"
                    value={createDraft.checkIn}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({ ...draft, checkIn: value }))
                    }
                  />
                  <Field
                    label="Check-out"
                    value={createDraft.checkOut}
                    onChange={(value) =>
                      setCreateDraft((draft) => ({ ...draft, checkOut: value }))
                    }
                  />
                </div>
                <Field
                  label="Trash / recycling"
                  value={createDraft.trash}
                  onChange={(value) =>
                    setCreateDraft((draft) => ({ ...draft, trash: value }))
                  }
                  placeholder="Pickup days, bins, chute — the assigned avatar reads this to guests"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Assigned avatar
                    </label>
                    <select
                      value={createDraft.assignedAvatarName}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          assignedAvatarName: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      {PROPERTY_AVATAR_NAMES.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Timezone
                    </label>
                    <select
                      value={createDraft.timezone}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          timezone: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    >
                      {PROPERTY_TIMEZONES.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <Field
                  label="Dedicated phone number"
                  value={createDraft.assignedPhoneNumber}
                  onChange={(value) =>
                    setCreateDraft((draft) => ({ ...draft, assignedPhoneNumber: value }))
                  }
                  placeholder="+1 (305) 555-0199"
                />
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">
                    Local tone / avatar system prompt
                  </label>
                  <textarea
                    value={createDraft.avatarSystemPrompt}
                    onChange={(event) =>
                      setCreateDraft((draft) => ({
                        ...draft,
                        avatarSystemPrompt: event.target.value,
                      }))
                    }
                    rows={3}
                    className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-sky-500"
                    placeholder="Texas vs Florida rules, quiet hours, HOA…"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">
                    AI Handbook
                  </label>
                  <textarea
                    value={createDraft.handbook}
                    onChange={(event) =>
                      setCreateDraft((draft) => ({
                        ...draft,
                        handbook: event.target.value,
                      }))
                    }
                    rows={5}
                    className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-sky-500"
                    placeholder="Instructions the phone AI should read on a live call..."
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-sky-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                    disabled={!createDraft.name.trim()}
                  >
                    Save property
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {isSmartLockOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={handleCloseModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="smart-locks-modal-title"
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-sky-200 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 id="smart-locks-modal-title" className="text-base font-semibold text-slate-900">
                  Smart Locks
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  Yale, August, and Seam — rotate the guest PIN and check lock battery.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-sky-50 hover:text-slate-900"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <SmartLocksEditor
              key={smartLocksPropertyId ?? "smart-locks"}
              listings={listings}
              initialPropertyId={smartLocksPropertyId}
              onClose={handleCloseModal}
              onSave={saveProperty}
              onSaved={() => setSaveToast("Smart lock PIN saved")}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SmartLocksEditor({
  listings,
  initialPropertyId,
  onClose,
  onSave,
  onSaved,
}: {
  listings: Property[];
  initialPropertyId?: string;
  onClose: () => void;
  onSave: (property: Property) => Promise<void>;
  onSaved: () => void;
}) {
  const fallbackId = listings[0]?.id ?? "";
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? fallbackId);
  const selected = listings.find((item) => item.id === propertyId) ?? listings[0];
  const [vendor, setVendor] = useState<LockVendor>(selected ? inferLockVendor(selected.smartlock) : "yale");
  const [pin, setPin] = useState(selected?.doorCode ?? "");
  const [seamConnected, setSeamConnected] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setVendor(inferLockVendor(selected.smartlock));
    setPin(selected.doorCode);
  }, [selected]);

  const battery = selected ? lockBatteryPct(selected.id) : 0;

  const save = async () => {
    if (!selected) return;
    const nextPin = pin.trim();
    if (!nextPin) return;
    setSaving(true);
    try {
      await onSave({
        ...selected,
        doorCode: nextPin,
        smartlock: LOCK_VENDOR_META[vendor].lockName,
      });
      onSaved();
      onClose();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Could not update smart lock");
    } finally {
      setSaving(false);
    }
  };

  if (!selected) {
    return <p className="text-sm text-slate-600">Add a listing first, then connect a lock.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">Listing</label>
        <select
          value={selected.id}
          onChange={(event) => setPropertyId(event.target.value)}
          className="w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          {listings.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">Integration</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(LOCK_VENDOR_META) as LockVendor[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setVendor(id)}
              className={`rounded-xl border px-2 py-2 text-xs font-bold ${
                vendor === id
                  ? "border-sky-600 bg-sky-600 text-white"
                  : "border-sky-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
              }`}
            >
              {LOCK_VENDOR_META[id].label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Devices sync through Seam. Toggle connectivity if the bridge drops.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
        <span className="text-xs font-medium text-slate-700">Seam bridge</span>
        <button
          type="button"
          onClick={() => setSeamConnected((value) => !value)}
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
            seamConnected ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
          }`}
        >
          {seamConnected ? "Connected" : "Offline"}
        </button>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">Guest door PIN</label>
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-sky-500"
          placeholder="4920#"
        />
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
        <div className="flex items-center justify-between text-xs font-medium text-slate-700">
          <span className="inline-flex items-center gap-1.5">
            <Battery className="h-3.5 w-3.5" />
            Battery
          </span>
          <span>{battery}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-200">
          <div
            className={`h-full rounded-full ${battery < 25 ? "bg-rose-400" : battery < 50 ? "bg-amber-400" : "bg-emerald-500"}`}
            style={{ width: `${battery}%` }}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-sky-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !pin.trim()}
          className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function ExpandPanel({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setShown(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), 300);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${
        shown ? "mt-4 grid-rows-[1fr]" : "mt-0 grid-rows-[0fr]"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
        active
          ? "border-sky-600 bg-sky-600 text-white"
          : "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
      }`}
    >
      {label}
    </button>
  );
}

function PropertyDetails({
  property,
  copiedId,
  onCopy,
  onOpenSmartLocks,
  onOpenHandbook,
  onSave,
}: {
  property: Property;
  copiedId: string | null;
  onCopy: (id: string, value: string) => void;
  onOpenSmartLocks: () => void;
  onOpenHandbook: () => void;
  onSave: (property: Property) => Promise<void>;
}) {
  const logs = propertyAccessLogs(property);
  const battery = lockBatteryPct(property.id);
  const lockStatus = lockStatusFor(property.smartlock, battery);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-800">
          Property specs
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-800">
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                Door &amp; lock
              </div>
              <button
                type="button"
                onClick={onOpenSmartLocks}
                className="rounded-md border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800 hover:bg-sky-100"
              >
                Smart locks
              </button>
            </div>
            <CopyField
              label="Door code"
              value={property.doorCode}
              copyId={`${property.id}-door`}
              copiedId={copiedId}
              onCopy={onCopy}
            />
            <p className="text-[11px] leading-relaxed text-slate-600">
              {property.smartlock || "No lock linked"} · Battery {battery}% ·{" "}
              {LOCK_STATUS_LABEL[lockStatus]}
            </p>
          </div>

          <div className="min-w-0 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
              <Wifi className="h-3.5 w-3.5" />
              Wi-Fi
            </div>
            <CopyField
              label="Network"
              value={property.wifiNetwork}
              copyId={`${property.id}-wifi-net`}
              copiedId={copiedId}
              onCopy={onCopy}
            />
            <CopyField
              label="Password"
              value={property.wifiPassword}
              copyId={`${property.id}-wifi-pw`}
              copiedId={copiedId}
              onCopy={onCopy}
            />
          </div>

          <div className="min-w-0 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
              <Car className="h-3.5 w-3.5" />
              Parking
            </div>
            <p className="text-[12px] leading-relaxed text-slate-800">
              {property.parking || "No parking notes"}
            </p>
            <CopyField
              label="Gate code"
              value={property.gateCode}
              copyId={`${property.id}-gate`}
              copiedId={copiedId}
              onCopy={onCopy}
            />
          </div>

          <div className="min-w-0 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <Clock className="h-3.5 w-3.5" />
              Stay hours
            </div>
            <p className="text-[12px] text-slate-800">Check-in: {property.checkIn}</p>
            <p className="text-[12px] text-slate-800">Check-out: {property.checkOut}</p>
            <p className="text-[11px] text-slate-600">Revenue (MTD): {property.revenue}</p>
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <User className="mt-0.5 h-3 w-3 shrink-0" />
              {property.currentGuest
                ? `Current guest: ${property.currentGuest}`
                : "No guest on site"}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Trash &amp; recycling
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-700">
            {property.trash || "No trash instructions yet."}
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-800">
          <History className="h-3.5 w-3.5" />
          Access logs
        </h4>
        <div className="max-h-48 overflow-y-auto overscroll-contain rounded-xl border border-sky-200 bg-sky-50">
          <ul className="divide-y divide-sky-100">
            {logs.map((log) => (
              <li key={`${log.at}-${log.event}`} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900">{log.event}</p>
                  <p className="text-[10px] font-medium text-slate-500">{log.at}</p>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{log.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <PropertyLocalGuidePanel propertyId={property.id} />

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-800">
          AI settings
        </h4>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <BookOpen className="h-3.5 w-3.5 text-sky-700" />
            AI Handbook
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">
            {property.handbook || "No handbook yet. Add instructions for the AI."}
          </p>
          <button
            type="button"
            onClick={onOpenHandbook}
            className="mt-3 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 transition-colors hover:bg-sky-100"
          >
            {property.handbook ? "Edit handbook" : "Add handbook"}
          </button>
        </div>
        <PropertyAgentEditor property={property} onSave={onSave} alwaysOpen />
      </section>
    </div>
  );
}

function OccupancyBadge({
  status,
  guest,
}: {
  status: OccupancyStatus;
  guest: string | null;
}) {
  const occupied = status === "Occupied";
  return (
    <div className="shrink-0 text-right">
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          occupied
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-slate-100 text-slate-700"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${occupied ? "bg-emerald-400" : "bg-slate-500"}`}
        />
        {status}
      </span>
      {guest ? (
        <p className="mt-0.5 max-w-[7.5rem] truncate text-[9px] text-slate-500">{guest}</p>
      ) : null}
    </div>
  );
}

function PropertyAgentEditor({
  property,
  onSave,
  alwaysOpen = false,
}: {
  property: Property;
  onSave: (property: Property) => Promise<void>;
  alwaysOpen?: boolean;
}) {
  const [assignedAvatarName, setAssignedAvatarName] = useState(property.assignedAvatarName);
  const [assignedPhoneNumber, setAssignedPhoneNumber] = useState(property.assignedPhoneNumber);
  const [timezone, setTimezone] = useState(property.timezone);
  const [avatarSystemPrompt, setAvatarSystemPrompt] = useState(property.avatarSystemPrompt);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);

  useEffect(() => {
    if (alwaysOpen) setExpanded(true);
  }, [alwaysOpen]);

  useEffect(() => {
    setAssignedAvatarName(property.assignedAvatarName);
    setAssignedPhoneNumber(property.assignedPhoneNumber);
    setTimezone(property.timezone);
    setAvatarSystemPrompt(property.avatarSystemPrompt);
  }, [
    property.id,
    property.assignedAvatarName,
    property.assignedPhoneNumber,
    property.timezone,
    property.avatarSystemPrompt,
  ]);

  const saveAgent = () => {
    setSaving(true);
    void (async () => {
      try {
        await onSave({
          ...property,
          assignedAvatarName,
          assignedPhoneNumber,
          timezone,
          avatarSystemPrompt,
        });
      } catch (cause) {
        window.alert(cause instanceof Error ? cause.message : "Could not save agent");
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
      {alwaysOpen ? (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-800">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          Dedicated agent &amp; number
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-sky-800">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Agent: {assignedAvatarName} · {assignedPhoneNumber}
            </span>
          </span>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-sky-700">
            {expanded ? "Hide" : "Edit"}
          </span>
        </button>
      )}
      {expanded || alwaysOpen ? (
        <div className={alwaysOpen ? "space-y-2" : "mt-2 space-y-2 border-t border-sky-200 pt-2"}>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={assignedAvatarName}
              onChange={(event) => setAssignedAvatarName(event.target.value)}
              className="rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs text-slate-900"
              aria-label="Assigned avatar"
            >
              {PROPERTY_AVATAR_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs text-slate-900"
              aria-label="Timezone"
            >
              {PROPERTY_TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <input
            value={assignedPhoneNumber}
            onChange={(event) => setAssignedPhoneNumber(event.target.value)}
            className="w-full rounded-lg border border-sky-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900"
            placeholder="+1 (305) 555-0199"
            aria-label="Assigned phone number"
          />
          <textarea
            value={avatarSystemPrompt}
            onChange={(event) => setAvatarSystemPrompt(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs text-slate-900"
            placeholder="Local tone: Texas, Florida, HOA…"
            aria-label="Avatar system prompt"
          />
          <button
            type="button"
            onClick={saveAgent}
            disabled={saving}
            className="w-full rounded-lg bg-sky-600 py-1.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save agent routing"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
      />
    </div>
  );
}
