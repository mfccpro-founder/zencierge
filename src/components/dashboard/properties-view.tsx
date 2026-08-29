"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Car,
  Clock,
  Copy,
  Check,
  KeyRound,
  MapPin,
  Plus,
  Wifi,
  BookOpen,
  ExternalLink,
  X,
  User,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import {
  propertyCities,
  type Property,
  type PropertyCity,
  type OccupancyStatus,
} from "@/lib/dashboard-data";
import { useListings } from "@/components/dashboard/listings-provider";
import { useSubscriptionTier } from "@/hooks/use-subscription-tier";
import { getSupabase } from "@/lib/supabase";

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
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          {label}
        </p>
        <p
          className={`mt-0.5 text-sm text-slate-200 break-all ${mono ? "font-mono" : ""}`}
        >
          {value || "—"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(copyId, value)}
        disabled={!value || value === "—"}
        className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none"
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 text-emerald-400" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            Copy
          </>
        )}
      </button>
    </div>
  );
}

export function PropertiesView() {
  const { properties: listings, saveProperty, applyHandbook, loading, error } = useListings();
  const { canAddProperty, planName, maxProperties, isActive } = useSubscriptionTier();
  const [cityFilter, setCityFilter] = useState<CityFilter>("all");
  const [occupancyFilter, setOccupancyFilter] = useState<OccupancyFilter>("all");
  const [modal, setModal] = useState<ModalMode>({ kind: "closed" });
  const [handbookDraft, setHandbookDraft] = useState("");
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingHandbook, setSavingHandbook] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return listings.filter((property) => {
      const cityOk = cityFilter === "all" || property.city === cityFilter;
      const statusOk =
        occupancyFilter === "all" || property.status === occupancyFilter;
      return cityOk && statusOk;
    });
  }, [listings, cityFilter, occupancyFilter]);

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
    <div className="space-y-6">
      {saveToast ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300"
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
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-800" />
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
          className="shrink-0 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-indigo-900 hover:bg-indigo-100"
        >
          Elena voice settings
        </Link>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
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
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add New Property
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 px-6 py-16 text-center">
          <Building2 className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            No properties match this filter
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Try another city or occupancy status.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {filtered.map((property) => (
            <article
              key={property.id}
              className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-sm space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    {property.name}
                  </h3>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                    <MapPin className="h-3.5 w-3.5 text-slate-500" />
                    {property.city} · {property.address}
                  </p>
                </div>
                <OccupancyBadge
                  status={property.status}
                  guest={property.currentGuest}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                    <KeyRound className="h-3.5 w-3.5" />
                    Door / Smartlock
                  </div>
                  <CopyField
                    label="Door code"
                    value={property.doorCode}
                    copyId={`${property.id}-door`}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                  />
                  <p className="text-[11px] text-slate-500">{property.smartlock}</p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                    <Wifi className="h-3.5 w-3.5" />
                    Wi-Fi
                  </div>
                  <CopyField
                    label="Network"
                    value={property.wifiNetwork}
                    copyId={`${property.id}-wifi-net`}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                  />
                  <CopyField
                    label="Password"
                    value={property.wifiPassword}
                    copyId={`${property.id}-wifi-pw`}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                  />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-violet-300">
                    <Car className="h-3.5 w-3.5" />
                    Parking
                  </div>
                  <p className="text-sm text-slate-200">{property.parking}</p>
                  <CopyField
                    label="Gate code"
                    value={property.gateCode}
                    copyId={`${property.id}-gate`}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                  />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                    <Clock className="h-3.5 w-3.5" />
                    Check-in / Check-out
                  </div>
                  <p className="text-sm text-slate-200">In: {property.checkIn}</p>
                  <p className="text-sm text-slate-200">Out: {property.checkOut}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <User className="h-3 w-3" />
                    {property.currentGuest
                      ? `Current guest: ${property.currentGuest}`
                      : "No guest on site"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                    <BookOpen className="h-3.5 w-3.5 text-emerald-400" />
                    AI Handbook
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Read by the phone assistant on live calls
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                  {property.handbook || "No handbook yet. Add instructions for the AI."}
                </p>
                <button
                  type="button"
                  onClick={() => openHandbook(property)}
                  className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-800 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
                >
                  {property.handbook ? "Edit AI Handbook" : "Add AI Handbook"}
                </button>
                <a
                  href={`/guest/${property.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ver Portal del Huésped
                </a>
              </div>
            </article>
          ))}
        </div>
      )}

      {modal.kind !== "closed" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="property-modal-title"
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3
                  id="property-modal-title"
                  className="text-base font-semibold text-white"
                >
                  {modal.kind === "create"
                    ? "Add New Property"
                    : `AI Handbook · ${editingProperty?.name ?? ""}`}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {modal.kind === "create"
                    ? "New units appear in the knowledge base the voice line uses during calls."
                    : "These instructions are what the AI receptionist reads while on a guest call."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {modal.kind === "handbook" ? (
              <div className="space-y-4">
                <textarea
                  value={handbookDraft}
                  onChange={(event) => setHandbookDraft(event.target.value)}
                  rows={10}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-emerald-500"
                  placeholder="Door codes, Wi-Fi, parking, house rules, and what the AI must never authorize..."
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveHandbook}
                    disabled={savingHandbook}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
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
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
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
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
                    >
                      {propertyCities.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
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
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
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
                  placeholder="Pickup days, bins, chute — Elena reads this to guests"
                />
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
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
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-emerald-500"
                    placeholder="Instructions the phone AI should read on a live call..."
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
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
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
        active
          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
          : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200 hover:border-slate-700"
      }`}
    >
      {label}
    </button>
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
    <div className="text-right shrink-0">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
          occupied
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-slate-800 text-slate-300 border-slate-700"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${occupied ? "bg-emerald-400" : "bg-slate-500"}`}
        />
        {status}
      </span>
      {guest ? (
        <p className="mt-1 text-[10px] text-slate-500">{guest}</p>
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
      <label className="mb-1.5 block text-xs font-medium text-slate-400">
        {label}
      </label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
      />
    </div>
  );
}
