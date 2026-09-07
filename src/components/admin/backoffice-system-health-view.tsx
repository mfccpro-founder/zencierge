"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  formatSystemHealthLatency,
  formatSystemHealthStatus,
} from "@/lib/admin-system-health-shared";
import type {
  SystemHealthHeader,
  SystemHealthServiceCard,
  SystemHealthServiceId,
  SystemHealthStatus,
} from "@/lib/admin-system-health-shared";

const SHORT_LABELS: Record<SystemHealthServiceId, string> = {
  platform: "Platform",
  guest_stay: "Guest Stay",
  isabela_text: "Isabela Text",
  isabela_voice: "Isabela Voice",
  housekeeping: "Housekeeping",
  secure_access: "Secure Access",
  supabase: "Supabase",
  square_billing: "Square",
  notifications: "Notifications",
};

function statusClasses(status: SystemHealthStatus) {
  if (status === "healthy") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "degraded") return "border-amber-200 bg-amber-50 text-amber-950";
  if (status === "down") return "border-rose-200 bg-rose-50 text-rose-950";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function statusDot(status: SystemHealthStatus) {
  if (status === "healthy") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-400";
}

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function ServiceDetailPanel(input: {
  service: SystemHealthServiceCard;
  panelId: string;
  onClose: () => void;
  dense?: boolean;
}) {
  const { service, panelId, onClose, dense } = input;
  return (
    <div
      id={panelId}
      className={`space-y-2 rounded-lg border border-slate-200 bg-white shadow-sm ${
        dense ? "px-3 py-2.5" : "px-4 py-3"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-bold text-slate-900 ${dense ? "text-sm" : "text-base"}`}>
            {SHORT_LABELS[service.id]}
          </p>
          <p className={`mt-1 leading-snug text-slate-700 ${dense ? "text-xs" : "text-sm"}`}>
            {service.reason}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <dl className={`grid grid-cols-1 gap-1 text-slate-700 sm:grid-cols-3 ${dense ? "text-[11px]" : "text-xs"}`}>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-slate-500">Last check</dt>
          <dd className="tabular-nums sm:mt-0.5">{formatWhen(service.checkedAt)}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-slate-500">Last activity</dt>
          <dd className="tabular-nums sm:mt-0.5">{formatWhen(service.lastActivityAt)}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-slate-500">Latency</dt>
          <dd className="tabular-nums sm:mt-0.5">{formatSystemHealthLatency(service.latencyMs)}</dd>
        </div>
      </dl>
      {service.detailLines.length > 0 ? (
        <ul
          className={`space-y-0.5 border-t border-slate-100 pt-2 leading-snug text-slate-600 ${
            dense ? "text-[10px]" : "text-xs"
          }`}
        >
          {service.detailLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {service.id === "isabela_voice" ? (
        <Link
          href="/backoffice/isabela-usage"
          className="inline-block text-[11px] font-semibold text-slate-800 underline"
        >
          Open Isabela Usage
        </Link>
      ) : null}
      {service.id === "square_billing" ? (
        <Link
          href="/backoffice/income"
          className="inline-block text-[11px] font-semibold text-slate-800 underline"
        >
          Open Income
        </Link>
      ) : null}
    </div>
  );
}

export function BackOfficeSystemHealthMobile(input: {
  header: SystemHealthHeader;
  generatedAt: string;
  services: SystemHealthServiceCard[];
}) {
  const [openId, setOpenId] = useState<SystemHealthServiceId | null>(null);
  const openService = useMemo(
    () => input.services.find((service) => service.id === openId) ?? null,
    [input.services, openId],
  );

  return (
    <div className="space-y-2 md:hidden">
      <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">System Health</p>
        <p className="mt-0.5 text-xs font-bold leading-tight text-slate-900">
          Healthy {input.header.healthyCount} · Degraded {input.header.degradedCount} · Down{" "}
          {input.header.downCount} · Unknown {input.header.unknownCount}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5" aria-label="Service health status">
        {input.services.map((service) => {
          const selected = openId === service.id;
          const shortLabel = SHORT_LABELS[service.id];
          return (
            <button
              key={service.id}
              type="button"
              aria-pressed={selected}
              aria-expanded={selected}
              aria-controls="system-health-mobile-detail"
              onClick={() => setOpenId(selected ? null : service.id)}
              className={`flex min-h-12 flex-col items-start justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-left active:bg-slate-50 ${
                selected ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white"
              }`}
            >
              <span className="flex w-full items-center gap-1.5">
                <span
                  className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(service.status)}`}
                  aria-hidden
                />
                <span className="truncate text-[12px] font-semibold leading-none text-slate-900">
                  {shortLabel}
                </span>
              </span>
              <span
                className={`ml-[11px] inline-flex max-w-full truncate rounded border px-1 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide ${statusClasses(service.status)}`}
              >
                {formatSystemHealthStatus(service.status)}
              </span>
            </button>
          );
        })}
      </div>

      {openService ? (
        <ServiceDetailPanel
          service={openService}
          panelId="system-health-mobile-detail"
          dense
          onClose={() => setOpenId(null)}
        />
      ) : (
        <p className="px-0.5 text-[10px] text-slate-500">Tap a service for details</p>
      )}
    </div>
  );
}

export function BackOfficeSystemHealthDesktop(input: {
  header: SystemHealthHeader;
  generatedAt: string;
  timeZone: string;
  services: SystemHealthServiceCard[];
}) {
  const [openId, setOpenId] = useState<SystemHealthServiceId | null>(null);
  const openService = useMemo(
    () => input.services.find((service) => service.id === openId) ?? null,
    [input.services, openId],
  );

  return (
    <div className="hidden space-y-4 md:block">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">System Health</p>
        <p className="mt-1 text-lg font-bold text-slate-900">
          Healthy {input.header.healthyCount} · Degraded {input.header.degradedCount} · Down{" "}
          {input.header.downCount} · Unknown {input.header.unknownCount}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Checked {formatWhen(input.generatedAt)} · {input.timeZone} · click a service for details
        </p>
      </div>

      {/* Tablet: 2 cols · Desktop: 3×3 — larger cards, details stay click-to-open */}
      <div
        className="grid grid-cols-2 gap-4 lg:grid-cols-3 lg:gap-5"
        aria-label="Service health status grid"
      >
        {input.services.map((service) => {
          const selected = openId === service.id;
          const shortLabel = SHORT_LABELS[service.id];
          return (
            <button
              key={service.id}
              type="button"
              aria-pressed={selected}
              aria-expanded={selected}
              aria-controls="system-health-desktop-detail"
              onClick={() => setOpenId(selected ? null : service.id)}
              className={`flex min-h-[7rem] flex-col items-start justify-between gap-3 overflow-hidden rounded-xl border px-4 py-3.5 text-left transition-colors hover:bg-slate-50 lg:min-h-[7.5rem] lg:px-5 lg:py-4 ${
                selected ? "border-slate-400 bg-slate-50 shadow-sm" : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <span className="flex w-full items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`mt-1.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(service.status)}`}
                    aria-hidden
                  />
                  <span className="truncate text-base font-bold leading-tight text-slate-900 lg:text-lg">
                    {shortLabel}
                  </span>
                </span>
                <span
                  className={`inline-flex shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide lg:px-2.5 lg:py-1 lg:text-xs ${statusClasses(service.status)}`}
                >
                  {formatSystemHealthStatus(service.status)}
                </span>
              </span>
              <span className="line-clamp-1 w-full pl-[1.375rem] text-sm leading-snug text-slate-500">
                {service.reason}
              </span>
            </button>
          );
        })}
      </div>

      {openService ? (
        <ServiceDetailPanel
          service={openService}
          panelId="system-health-desktop-detail"
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
