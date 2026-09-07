"use client";

import type { LocalGuidePublicResult } from "@/lib/local-guide-shared";

export function HostGuideResults({ results }: { results: LocalGuidePublicResult[] }) {
  const rows = results.slice(0, 3).filter((row) => row.businessName.trim() && row.source === "host");
  if (!rows.length) return null;

  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="mb-2 text-xs font-medium text-amber-900">Recommended by your host</p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="text-sm text-slate-900">
            <span className="font-medium">{row.businessName}</span>
            {row.distanceMiles != null ? (
              <span className="text-slate-600"> · {row.distanceMiles} mi</span>
            ) : null}
            {row.hostNote ? <p className="mt-0.5 text-xs text-slate-700">{row.hostNote}</p> : null}
            {row.websiteOrMapsLink.startsWith("http") ? (
              <a
                href={row.websiteOrMapsLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block text-xs text-sky-800 underline underline-offset-2"
              >
                Open link
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
