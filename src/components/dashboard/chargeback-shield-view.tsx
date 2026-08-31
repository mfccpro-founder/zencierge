"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Download,
  FileWarning,
  KeyRound,
  MessageSquare,
  PenLine,
  Sparkles,
} from "lucide-react";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { useListings } from "@/components/dashboard/listings-provider";
import { reservations as seedReservations } from "@/lib/dashboard-data";
import {
  compileChargebackDossiers,
  formatChargebackDossierText,
  type ChargebackDossier,
  type ShieldCoverage,
} from "@/lib/chargeback-shield";

const COVERAGE_STYLE: Record<ShieldCoverage, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partial: "border-amber-200 bg-amber-50 text-amber-900",
  gap: "border-rose-200 bg-rose-50 text-rose-800",
};

const COVERAGE_LABEL: Record<ShieldCoverage, string> = {
  complete: "Shield complete",
  partial: "Partial pack",
  gap: "Evidence gap",
};

function downloadDossier(dossier: ChargebackDossier) {
  const body = formatChargebackDossierText(dossier);
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${dossier.exhibitId}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ChargebackShieldView() {
  const { properties, reservations, loading } = useListings();
  const [openId, setOpenId] = useState<string | null>(null);

  const dossiers = useMemo(() => {
    const rows = reservations.length ? reservations : seedReservations;
    return compileChargebackDossiers(properties, rows);
  }, [properties, reservations]);

  if (loading && properties.length === 0) {
    return <p className="text-sm text-slate-500">Loading reservations…</p>;
  }

  const complete = dossiers.filter((row) => row.coverage === "complete").length;

  return (
    <div className="space-y-6">
      <HostHeroBanner
        tone="shield"
        title="Chargeback Shield"
        subtitle="A dispute dossier for every reservation — house-rules signatures, smart-lock timestamps, voice logs, and turnover proofs."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-800">Auto dossiers</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{dossiers.length}</p>
          <p className="mt-1 text-xs text-sky-800">One pack per reservation</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-800">Chargeback-ready</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{complete}</p>
          <p className="mt-1 text-xs text-sky-800">Signature + lock + comms + housekeeping</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-800">AirCover exhibit</p>
          <Link
            href="/dashboard/dispute-dossier"
            className="mt-2 inline-flex text-sm font-semibold text-sky-800 hover:underline"
          >
            Open PDF / forensic builder →
          </Link>
          <p className="mt-1 text-xs text-sky-800">Attach this pack when a claim is filed</p>
        </div>
      </div>

      {dossiers.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-700">
          No reservations yet. When a booking lands on the calendar, a dossier is generated automatically.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
          <div className="max-h-[min(24rem,50vh)] overflow-y-auto overscroll-contain">
            {dossiers.map((dossier) => {
              const open = openId === dossier.id;
              return (
                <article key={dossier.id} className="border-b border-sky-100 last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : dossier.id)}
                    className={`flex min-h-[4.5rem] w-full items-center gap-3 px-5 py-4 text-left ${
                      open ? "bg-blue-800 text-white" : "bg-sky-50 text-slate-900 hover:bg-sky-100"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-bold ${open ? "text-white" : "text-slate-900"}`}>
                        {dossier.guest}
                      </p>
                      <p className={`mt-0.5 truncate text-xs ${open ? "text-sky-100" : "text-sky-800"}`}>
                        {dossier.propertyName} · {dossier.platform}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${COVERAGE_STYLE[dossier.coverage]}`}
                    >
                      {COVERAGE_LABEL[dossier.coverage]} · {dossier.coveragePct}%
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 transition-transform duration-300 ${open ? "rotate-180 text-white" : "text-sky-600"}`}
                    />
                  </button>
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                      open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="space-y-4 bg-sky-50 px-5 py-4">
                        <p className="text-xs text-sky-800">
                          {dossier.checkIn} → {dossier.checkOut}
                        </p>
                        <p className="font-mono text-[11px] text-sky-700">{dossier.exhibitId}</p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <EvidenceBlock
                            icon={PenLine}
                            title="Digital signatures & house rules"
                            lines={dossier.signatures}
                          />
                          <EvidenceBlock icon={KeyRound} title="Smart lock audit log" lines={dossier.lockLogs} />
                          <EvidenceBlock
                            icon={MessageSquare}
                            title="Chat & voice assistant records"
                            lines={dossier.communications}
                          />
                          <EvidenceBlock
                            icon={Sparkles}
                            title="Housekeeping & condition proofs"
                            lines={dossier.housekeeping}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => downloadDossier(dossier)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-3 py-2 text-xs font-bold text-white hover:bg-sky-600"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download dossier
                          </button>
                          <Link
                            href={`/dashboard/dispute-dossier?reservation=${dossier.reservationId}`}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-sky-100"
                          >
                            <FileWarning className="h-3.5 w-3.5" />
                            File AirCover exhibit
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceBlock({
  icon: Icon,
  title,
  lines,
}: {
  icon: typeof PenLine;
  title: string;
  lines: ChargebackDossier["signatures"];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-sky-700" />
        <h3 className="text-xs font-bold text-slate-900">{title}</h3>
      </div>
      <ul className="space-y-2">
        {lines.map((line, index) => (
          <li key={`${line.title}-${index}`} className="text-xs text-slate-700">
            <p className="font-semibold text-slate-900">{line.title}</p>
            <p className="text-[11px] text-slate-500">{line.at}</p>
            <p className="mt-0.5 leading-relaxed">{line.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
