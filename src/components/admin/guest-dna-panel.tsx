"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";

type GuestRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  propertyId: string;
  riskStatus: "clear" | "watch" | "flagged" | "unknown";
  riskTags?: string[];
  riskNotes: string | null;
  checkInAt: string;
  marketingOptIn: boolean;
};

type Snapshot = {
  serviceRoleReady: boolean;
  error: string | null;
  guests: GuestRow[];
  metrics: { total: number; leads: number; flagged: number; watch: number; clear: number };
};

const TAG_BADGE: Record<string, { label: string; className: string }> = {
  chargeback: { label: "Chargeback", className: "border-rose-800 bg-rose-700 text-white" },
  false_dispute: { label: "False dispute", className: "border-orange-800 bg-orange-700 text-white" },
  watch: { label: "Watch", className: "border-amber-800 bg-amber-600 text-white" },
  clear: { label: "Clear", className: "border-emerald-800 bg-emerald-700 text-white" },
};

export function GuestDnaPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/guest-dna")
      .then((res) => res.json() as Promise<Snapshot>)
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch(() => {
        if (active) {
          setSnapshot({
            serviceRoleReady: false,
            error: "Failed to load guest data.",
            guests: [],
            metrics: { total: 0, leads: 0, flagged: 0, watch: 0, clear: 0 },
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const exportCsv = () => {
    setExporting(true);
    window.location.href = "/api/admin/guest-dna?format=csv";
    window.setTimeout(() => setExporting(false), 1500);
  };

  if (!snapshot) {
    return (
      <div className="flex items-center gap-2 text-lg text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading guest DNA…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "Captured Guests (All Time)", value: snapshot.metrics.total },
          { label: "Direct Marketing Leads (Opt-in)", value: snapshot.metrics.leads },
          { label: "Flagged Guests", value: snapshot.metrics.flagged },
          { label: "Under Watch", value: snapshot.metrics.watch },
          { label: "Clear", value: snapshot.metrics.clear },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-4xl font-extrabold tracking-tight text-slate-900">{card.value}</p>
            <p className="mt-2 text-sm font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
          </div>
        ))}
      </div>

      {snapshot.error || !snapshot.serviceRoleReady ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {snapshot.error ?? "SUPABASE_SERVICE_ROLE_KEY is not configured."}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-slate-900">Captured Contacts &amp; Direct Leads</h2>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-base font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {exporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          Export Leads CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1100px] text-left text-base">
          <thead className="border-b border-slate-300 bg-slate-100 text-sm font-semibold uppercase tracking-wide text-slate-900">
            <tr>
              <th className="px-6 py-5">Guest</th>
              <th className="px-6 py-5">Email</th>
              <th className="px-6 py-5">Phone</th>
              <th className="px-6 py-5">Property</th>
              <th className="px-6 py-5">Risk tags</th>
              <th className="px-6 py-5">Check-in</th>
              <th className="px-6 py-5">Lead</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {snapshot.guests.map((guest) => {
              const tags = guest.riskTags?.length
                ? guest.riskTags
                : guest.riskStatus === "flagged"
                  ? ["chargeback"]
                  : [guest.riskStatus];
              return (
                <tr key={guest.id} className="align-top transition-colors hover:bg-slate-50">
                  <td className="px-6 py-6 font-semibold text-slate-900">{guest.fullName}</td>
                  <td className="px-6 py-6 text-slate-900">{guest.email}</td>
                  <td className="px-6 py-6 text-slate-900">{guest.phone}</td>
                  <td className="px-6 py-6 font-mono text-sm text-slate-900">{guest.propertyId}</td>
                  <td className="px-6 py-6">
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => {
                        const badge = TAG_BADGE[tag] ?? {
                          label: tag,
                          className: "border-slate-800 bg-slate-700 text-white",
                        };
                        return (
                          <span
                            key={tag}
                            className={`inline-block rounded-full border px-3 py-1 text-xs font-bold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        );
                      })}
                    </div>
                    {guest.riskNotes ? <p className="mt-2 max-w-xs text-sm text-slate-900">⚠ {guest.riskNotes}</p> : null}
                  </td>
                  <td className="px-6 py-6 text-slate-900">{new Date(guest.checkInAt).toLocaleDateString("en-US")}</td>
                  <td className="px-6 py-6">
                    {guest.marketingOptIn ? (
                      <span className="font-semibold text-slate-900">✓ Opt-in</span>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {snapshot.guests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-lg text-slate-700">
                  No captured guests yet. Entries appear here after guests pass the /guest/[id] check-in gate.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
