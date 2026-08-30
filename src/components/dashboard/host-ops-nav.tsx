"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isDashboardNavActive } from "@/lib/dashboard-nav";
import { ChevronDown } from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Overview", match: "exact" as const },
  {
    href: "/dashboard/properties",
    label: "Properties & Elena AI",
    match: "prefix" as const,
    children: [
      { href: "/dashboard/properties#smart-locks", label: "Smart Locks" },
      { href: "/dashboard/properties#heygen", label: "HeyGen" },
      { href: "/dashboard/properties#guest-qr", label: "QR Cards" },
    ],
  },
  {
    href: "/dashboard/housekeeping",
    label: "Housekeeping",
    match: "prefix" as const,
    children: [
      { href: "/dashboard/housekeeping#live-board", label: "Live Board" },
      { href: "/dashboard/housekeeping#turno-shifts", label: "Turno shifts" },
      { href: "/dashboard/housekeeping#escrow-payouts", label: "Escrow Payouts" },
    ],
  },
  {
    href: "/dashboard/guest-dna",
    label: "Guest DNA",
    match: "prefix" as const,
    children: [
      { href: "/dashboard/guest-dna#direct-bookings", label: "Direct Bookings" },
      { href: "/dashboard/guest-dna#id-verification", label: "ID Verification" },
    ],
  },
  { href: "/dashboard/neighbor-shield", label: "NeighborShield", match: "prefix" as const },
  { href: "/dashboard/dispute-dossier", label: "Dispute Dossier", match: "prefix" as const },
  { href: "/dashboard/settings", label: "Settings", match: "prefix" as const },
];

export function HostOpsNav() {
  const pathname = usePathname() || "/dashboard";

  return (
    <nav className="flex items-center gap-1.5 flex-wrap">
      {NAV_LINKS.map((link) => {
        const active = isDashboardNavActive(pathname, link.href, link.match);
        const children = "children" in link ? link.children : undefined;

        return (
          <div key={link.href} className="group relative">
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700 font-semibold border border-blue-200/60"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>{link.label}</span>
              {children ? (
                <ChevronDown className={`w-3 h-3 ${active ? "text-blue-600" : "text-slate-400"}`} />
              ) : null}
            </Link>
            {children ? (
              <div className="invisible absolute left-0 top-full z-50 min-w-[200px] pt-1 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <div className="rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  {children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className="block rounded-md px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
