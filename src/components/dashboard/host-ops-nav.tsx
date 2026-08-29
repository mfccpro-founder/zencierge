"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isDashboardNavActive } from "@/lib/dashboard-nav";

const LINKS = [
  { href: "/dashboard", label: "Overview", match: "exact" as const },
  { href: "/dashboard/properties", label: "Properties & Elena AI", match: "prefix" as const },
  { href: "/dashboard/housekeeping", label: "Housekeeping", match: "prefix" as const, tour: "escrow" },
  { href: "/dashboard/guest-dna", label: "Guest DNA", match: "prefix" as const },
  { href: "/dashboard/neighbor-shield", label: "NeighborShield", match: "prefix" as const },
  { href: "/dashboard/dispute-dossier", label: "Dispute Dossier", match: "prefix" as const },
];

const tabClass = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:text-slate-900"
  }`;

export function HostOpsNav() {
  const pathname = usePathname() || "/dashboard";
  const settingsActive = isDashboardNavActive(pathname, "/dashboard/settings", "prefix");

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        const active = isDashboardNavActive(pathname, link.href, link.match);
        return (
          <Link
            key={link.href}
            href={link.href}
            data-tour={link.href === "/dashboard/housekeeping" ? "escrow" : undefined}
            aria-current={active ? "page" : undefined}
            className={tabClass(active)}
          >
            {link.label}
          </Link>
        );
      })}
      <Link href="/dashboard/settings" aria-current={settingsActive ? "page" : undefined} className={tabClass(settingsActive)}>
        Settings
      </Link>
    </nav>
  );
}
