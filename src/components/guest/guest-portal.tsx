"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  KeyRound,
  MapPin,
  Phone,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";
import { fetchPropertyById } from "@/lib/supabase-listings";

const ELENA_AI_PHONE = "+1 (305) 555-0199";

export function GuestPortal({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedWifi, setCopiedWifi] = useState(false);
  const elenaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await fetchPropertyById(propertyId);
        if (!cancelled) {
          setProperty(row);
          setLoadError(row ? null : "We couldn't find this stay.");
        }
      } catch (cause) {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : "Could not load this stay.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const copyWifiPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopiedWifi(true);
      window.setTimeout(() => setCopiedWifi(false), 1800);
    } catch {
      window.alert(password);
    }
  };

  const talkToElena = () => {
    elenaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      document.getElementById("elena-guest-input")?.focus();
    }, 400);
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-[#07080c] text-slate-300 flex items-center justify-center px-6">
        <p className="text-sm">Preparing your stay…</p>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-dvh bg-[#07080c] text-slate-300 flex items-center justify-center px-6 text-center">
        <p className="text-sm">{loadError ?? "Stay not found."}</p>
      </div>
    );
  }

  const fullAddress = `${property.address}, ${property.city}, FL`;
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(fullAddress)}`;
  const elenaTel = ELENA_AI_PHONE.replace(/[^\d+]/g, "");

  return (
    <div className="min-h-dvh bg-[#07080c] text-slate-100">
      <div className="mx-auto max-w-md px-5 pt-8 pb-20">
        <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/80 font-semibold">
          Zencierge · Guest
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{property.name}</h1>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-start gap-2 text-sm text-slate-300 leading-relaxed"
        >
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Your Location
            </span>
            {fullAddress}
          </span>
        </a>

        <button
          type="button"
          onClick={talkToElena}
          className="mt-8 w-full rounded-2xl bg-emerald-500 py-4 text-base font-bold text-slate-950 shadow-lg shadow-emerald-500/25 hover:bg-emerald-400"
        >
          Talk to Elena AI
        </button>

        <a
          href={`tel:${elenaTel}`}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 py-3.5 text-sm font-bold text-emerald-200 hover:bg-emerald-500/20"
        >
          <Phone className="h-4 w-4" />
          Call Elena {ELENA_AI_PHONE}
        </a>

        <div ref={elenaRef} id="elena-ai" className="mt-8 scroll-mt-4">
          <ElenaVoiceWidget />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={() => void copyWifiPassword(property.wifiPassword)}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-emerald-500/30"
          >
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
              <Wifi className="h-4 w-4" />
              Wi-Fi
            </div>
            <p className="mt-2 text-sm text-slate-200">
              <span className="text-slate-500">Network:</span> {property.wifiNetwork}
            </p>
            <p className="text-sm text-slate-200">
              <span className="text-slate-500">Password:</span>{" "}
              {copiedWifi ? "Copied!" : property.wifiPassword}
            </p>
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
              {copiedWifi ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copiedWifi ? "Copied!" : "Copy Password"}
            </p>
          </button>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-sky-300 text-xs font-semibold">
              <KeyRound className="h-4 w-4" />
              Door Access Code
            </div>
            <p className="mt-2 text-sm text-slate-200">{property.doorCode}</p>
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
            <p className="mt-0.5 text-sm font-semibold text-white">{fullAddress}</p>
          </a>
        </div>
      </div>
    </div>
  );
}
