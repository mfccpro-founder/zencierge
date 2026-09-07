"use client";

import type { ConciergeLiveResult } from "@/lib/ask-avatar";

export const GOOGLE_MAPS_TEXT_ATTRIBUTION = {
  text: "Google Maps" as const,
  translate: "no" as const,
};

export function GoogleMapsLiveResults({ results }: { results: ConciergeLiveResult[] }) {
  const rows = results.slice(0, 3).filter((row) => row.name.trim() && row.mapsUri.startsWith("https://"));
  if (!rows.length) return null;

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs font-medium text-slate-600">Nearby places</p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={`${row.name}:${row.mapsUri}`}>
            <a
              href={row.mapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sky-800 underline underline-offset-2 hover:text-sky-950"
            >
              {row.name}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3">
        <span
          translate={GOOGLE_MAPS_TEXT_ATTRIBUTION.translate}
          className="text-[13px] font-normal text-[#5E5E5E]"
        >
          {GOOGLE_MAPS_TEXT_ATTRIBUTION.text}
        </span>
      </p>
    </div>
  );
}
