"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  MapPin,
  Wifi,
  ShoppingBag,
} from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";
import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import { groceryFromHandbook } from "@/lib/receptionist-intent";
import { HOST_EMERGENCY_NUMBER } from "@/lib/receptionist-replies";
import { fetchPropertyById } from "@/lib/supabase-listings";

export function GuestPortal({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

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

  const copyWifi = async (stay: Property) => {
    const payload = `${stay.wifiNetwork} · ${stay.wifiPassword}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.alert(payload);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07080c] text-slate-300 flex items-center justify-center px-6">
        <p className="text-sm">Preparing your stay…</p>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-[#07080c] text-slate-300 flex items-center justify-center px-6 text-center">
        <p className="text-sm">{loadError ?? "Stay not found."}</p>
      </div>
    );
  }

  const grocery = groceryFromHandbook(property, "es");
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(property.address || property.name)}`;
  const tel = HOST_EMERGENCY_NUMBER.replace(/[^\d+]/g, "");

  return (
    <div className="min-h-screen bg-[#07080c] text-slate-100">
      <div className="mx-auto max-w-md px-5 pt-10 pb-16">
        <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/80 font-semibold">
          Zencierge · Guest
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{property.name}</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          Welcome. Elena is your concierge for this stay in {property.city}. Ask about Wi-Fi,
          Publix, parking, or check-in — in English or Spanish.
        </p>

        <section className="mt-8">
          <div className="mb-5 flex justify-center">
            <ElenaAvatar size={112} />
          </div>
          <ElenaVoiceWidget />
        </section>

        <div className="mt-6 grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={() => void copyWifi(property)}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-emerald-500/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
              <Wifi className="h-4 w-4" />
              Copiar clave de Wi-Fi
            </div>
            <p className="mt-2 text-sm text-slate-200">
              {property.wifiNetwork} · {copied ? "Copied" : property.wifiPassword}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 inline-flex items-center gap-1">
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              One tap copies network and password
            </p>
          </button>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
              <Clock className="h-4 w-4" />
              Check-in / Check-out
            </div>
            <p className="mt-2 text-sm text-slate-200">In {property.checkIn}</p>
            <p className="text-sm text-slate-200">Out {property.checkOut}</p>
          </div>

          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 hover:border-sky-500/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-sky-300 text-xs font-semibold">
              <MapPin className="h-4 w-4" />
              Ubicación
            </div>
            <p className="mt-2 text-sm text-slate-200">{property.address}</p>
            <div className="mt-3 flex items-start gap-2 text-slate-400">
              <ShoppingBag className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">{grocery}</p>
            </div>
          </a>

          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-left"
          >
            <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Reportar un problema / Contactar anfitrión
            </div>
            <p className="mt-2 text-xs text-rose-100/70">Leaks, lockouts, and urgent issues.</p>
          </button>
        </div>
      </div>

      {reportOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          role="presentation"
          onClick={() => setReportOpen(false)}
        >
          <div
            role="dialog"
            className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-950 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-white">Host line</h2>
            <p className="mt-2 text-sm text-slate-400">
              For emergencies Elena can also transfer you. Call the host directly if you prefer.
            </p>
            <a
              href={`tel:${tel}`}
              className="mt-4 flex w-full items-center justify-center rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-slate-950"
            >
              Call {HOST_EMERGENCY_NUMBER}
            </a>
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="mt-2 w-full py-2 text-xs text-slate-500"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
