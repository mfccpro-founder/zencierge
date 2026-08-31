"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Car,
  Check,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  MapPin,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wifi,
} from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import { guestStayFallback } from "@/lib/dashboard-data";
import { ElenaGuestIsland } from "@/components/guest/elena-guest-island";
import { GuestGate } from "@/components/guest/guest-gate";
import { HousekeepingPhotoReportModal } from "@/components/housekeeping/housekeeping-photo-report-form";
import { GUEST_ADDONS, type GuestAddonId } from "@/lib/guest-addons";
import { startSquareCheckout } from "@/lib/start-square-checkout";
import { guestPressClass, withMobilePress } from "@/lib/guest-press";

export function GuestPortal(props: {
  propertyId: string;
  initialProperty?: Property;
}) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#07080c]" />}>
      <GuestPortalInner {...props} />
    </Suspense>
  );
}

function GuestPortalInner({
  propertyId,
  initialProperty,
}: {
  propertyId: string;
  initialProperty?: Property;
}) {
  const searchParams = useSearchParams();
  const property = initialProperty ?? guestStayFallback(propertyId);
  const [copiedWifi, setCopiedWifi] = useState(false);
  const [addonBusy, setAddonBusy] = useState<GuestAddonId | null>(null);
  const [hkReportOpen, setHkReportOpen] = useState(false);
  const paidAddon = searchParams.get("checkout") === "success" ? searchParams.get("addon") : null;

  const fullAddress = `${property.address}, ${property.city}, FL`;
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(fullAddress)}`;
  const gateCode = property.gateCode?.trim();
  const hasGateCode = Boolean(gateCode && gateCode !== "—");
  const parking = property.parking?.trim();
  const trash = property.trash?.trim();

  const buyAddon = async (addonId: GuestAddonId) => {
    if (addonBusy) return;
    setAddonBusy(addonId);
    try {
      await startSquareCheckout({ kind: "guest_addon", addonId, propertyId });
    } catch (cause) {
      setAddonBusy(null);
      window.alert(cause instanceof Error ? cause.message : "Checkout failed");
    }
  };

  const copyWifiPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopiedWifi(true);
      window.setTimeout(() => setCopiedWifi(false), 1800);
    } catch {
      window.alert(password);
    }
  };

  return (
    <GuestGate propertyId={propertyId} propertyName={property.name}>
      <div className="relative z-10 min-h-dvh w-full min-w-0 overflow-x-hidden bg-[#07080c] text-slate-100 touch-manipulation" suppressHydrationWarning>
      <div className="mx-auto w-full min-w-0 max-w-md px-4 pb-24 pt-6 sm:px-5 sm:pt-8">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/80">
          Zencierge · Guest
        </p>
        <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl">{property.name}</h1>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex w-full min-w-0 items-start gap-2 text-sm leading-relaxed text-slate-300"
        >
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Your Location
            </span>
            <span className="min-w-0 break-words">{fullAddress}</span>
          </span>
        </a>

        <ElenaGuestIsland property={property} />

        {paidAddon ? (
          <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            Square checkout complete
            {GUEST_ADDONS[paidAddon as GuestAddonId]
              ? ` · ${GUEST_ADDONS[paidAddon as GuestAddonId].name}`
              : ""}
            .
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2 text-sky-300 text-xs font-semibold">
            <Sparkles className="h-4 w-4" />
            Stay add-ons
          </div>
          <p className="mt-2 text-xs text-slate-400">Pay with Square Sandbox. Local mock checkout completes if keys are unset.</p>
          <div className="mt-4 grid grid-cols-1 gap-2">
            {(Object.keys(GUEST_ADDONS) as GuestAddonId[]).map((addonId) => {
              const addon = GUEST_ADDONS[addonId];
              return (
                <button
                  key={addonId}
                  type="button"
                  disabled={addonBusy !== null}
                  {...withMobilePress(() => void buyAddon(addonId))}
                  className={`${guestPressClass} flex w-full min-w-0 flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3 text-left hover:border-sky-500/40 disabled:opacity-70 sm:flex-row sm:items-center sm:justify-between`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{addon.name}</span>
                    <span className="block break-words text-[11px] text-slate-500">{addon.description}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-black text-sky-300">
                    {addonBusy === addonId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}$
                    {addon.usd}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3">
          <button
            type="button"
            {...withMobilePress(() => void copyWifiPassword(property.wifiPassword))}
            className={`${guestPressClass} rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-emerald-500/30`}
          >
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
              <Wifi className="h-4 w-4" />
              Wi-Fi
            </div>
            <p className="mt-2 break-words text-sm text-slate-200">
              <span className="text-slate-500">Network:</span> {property.wifiNetwork}
            </p>
            <p className="break-words text-sm text-slate-200">
              <span className="text-slate-500">Password:</span>{" "}
              {copiedWifi ? "Copied!" : property.wifiPassword}
            </p>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
              {copiedWifi ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copiedWifi ? "Copied!" : "Copy Password"}
            </div>
          </button>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-sky-300 text-xs font-semibold">
              <KeyRound className="h-4 w-4" />
              Door Access Code
            </div>
            <p className="mt-2 break-all text-sm text-slate-200">{property.doorCode}</p>
            <p className="text-xs text-slate-500">{property.smartlock}</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
              <Clock className="h-4 w-4" />
              Check-in / Check-out
            </div>
            <p className="mt-2 text-sm text-slate-200">In {property.checkIn}</p>
            <p className="text-sm text-slate-200">Out {property.checkOut}</p>
          </div>

          {parking || trash ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                House Rules
              </p>

              {parking ? (
                <div className="mt-3 flex items-start gap-2">
                  <Car className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                  <div>
                    <p className="text-xs font-semibold text-violet-300">Parking</p>
                    <p className="mt-0.5 break-words text-sm text-slate-200">{parking}</p>
                    {hasGateCode ? (
                      <p className="text-xs text-slate-500">Gate code: {gateCode}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {trash ? (
                <div className="mt-3 flex items-start gap-2">
                  <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
                  <div>
                    <p className="text-xs font-semibold text-teal-300">Trash and recycling</p>
                    <p className="mt-0.5 break-words text-sm text-slate-200">{trash}</p>
                  </div>
                </div>
              ) : null}

              <p className="mt-3 text-[11px] text-slate-500">
                Ask Elena for anything else about your stay — she answers in English or Spanish.
              </p>
            </div>
          ) : null}

          <button
            type="button"
            {...withMobilePress(() => setHkReportOpen(true))}
            className={`${guestPressClass} w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left`}
          >
            <p className="text-xs font-semibold text-emerald-300">Cleaning staff</p>
            <p className="mt-1 text-base font-black text-white">Housekeeping photo report</p>
            <p className="mt-1 text-xs text-emerald-100/80">
              Send Cleaned & Ready, Maintenance Issue, or Damage Found photos to the host.
            </p>
          </button>

          <a
            href="tel:911"
            className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4"
          >
            <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold">
              <ShieldAlert className="h-4 w-4" />
              Emergency 911
            </div>
            <p className="mt-2 text-lg font-black text-rose-100">911</p>
            <p className="mt-1 text-xs text-rose-100/80">
              Give this address to emergency services:
            </p>
            <p className="mt-0.5 break-words text-sm font-semibold text-white">{fullAddress}</p>
          </a>
        </div>
      </div>
      </div>
      <HousekeepingPhotoReportModal
        open={hkReportOpen}
        onClose={() => setHkReportOpen(false)}
        lockPropertyId={propertyId}
      />
    </GuestGate>
  );
}
