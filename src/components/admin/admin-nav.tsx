"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview", match: "exact" as const },
  { href: "/admin/hosts", label: "Hosts & Subscriptions", match: "prefix" as const },
  { href: "/admin/revenue", label: "Revenue", match: "prefix" as const },
  { href: "/admin/feedback", label: "Feature Requests", match: "prefix" as const },
];

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname() || "/admin";

  return (
    <nav className="flex flex-wrap items-center gap-1 text-xs">
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href, link.match);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 font-semibold transition-colors ${
              active
                ? "border border-slate-300 bg-slate-100 text-slate-900"
                : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
