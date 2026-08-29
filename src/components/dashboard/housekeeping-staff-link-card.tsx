"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";

const STAFF_PATH = "/housekeeping/upload";

function staffUploadUrl() {
  if (typeof window === "undefined") return STAFF_PATH;
  const envBase = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const base = envBase || window.location.origin;
  return `${base}${STAFF_PATH}`;
}

export function HousekeepingStaffLinkCard() {
  const [url, setUrl] = useState(STAFF_PATH);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(staffUploadUrl());
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy housekeeping staff link", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Cleaning staff</p>
      <h2 className="mt-1 text-base font-bold text-slate-900">Public photo upload link</h2>
      <p className="mt-1 text-sm text-slate-700">
        Share this URL with housekeepers. They can open it on a phone, pick a reservation, and upload check-in, check-out,
        or damage photos.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-800 sm:text-sm">
          {url}
        </code>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 sm:flex-none"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <Link
            href={STAFF_PATH}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-900 hover:bg-emerald-100"
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </Link>
        </div>
      </div>
    </section>
  );
}
