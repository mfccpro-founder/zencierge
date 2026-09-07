"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Filter = "succeeded" | "failed" | "all";

export function IncomeTransactionFilter(input: { current: Filter }) {
  const pathname = usePathname() || "/backoffice/income";
  const options: { id: Filter; label: string }[] = [
    { id: "succeeded", label: "Succeeded" },
    { id: "failed", label: "Failed" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = input.current === option.id;
        const href = option.id === "succeeded" ? pathname : `${pathname}?status=${option.id}`;
        return (
          <Link
            key={option.id}
            href={href}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              active
                ? "border border-slate-300 bg-slate-100 text-slate-900"
                : "border border-transparent text-slate-600 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
