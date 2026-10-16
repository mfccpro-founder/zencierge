"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

/**
 * Legacy team-tab entry point retained for imports outside the current view.
 * Cleaner access is always scoped to a selected property and stay; this card
 * deliberately cannot produce a generic upload URL.
 */
export function HousekeepingStaffLinkCard() {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Cleaning staff</p>
      <h2 className="mt-1 text-base font-bold text-slate-900">Secure cleaner access</h2>
      <p className="mt-1 text-sm text-slate-700">
        Select the property and stay in Inspections before sharing. Zencierge will create a private, time-limited mobile link for that task only.
      </p>
      <Link
        href="/dashboard/housekeeping"
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500"
      >
        <ExternalLink className="h-4 w-4" />
        Open Inspections
      </Link>
    </section>
  );
}
