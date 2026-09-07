"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/backoffice", label: "Overview", match: "exact" as const, status: "ready" as const },
  { href: "/backoffice/customers", label: "Customers", match: "prefix" as const, status: "ready" as const },
  { href: "/backoffice/billing", label: "Billing", match: "prefix" as const, status: "soon" as const },
  { href: "/backoffice/isabela-usage", label: "Isabela Usage", match: "prefix" as const, status: "ready" as const },
  { href: "/backoffice/income", label: "Income", match: "prefix" as const, status: "ready" as const },
  {
    href: "/backoffice/payroll-expenses",
    label: "Payroll & Expenses",
    match: "prefix" as const,
    status: "ready" as const,
  },
  { href: "/backoffice/profit", label: "Profit", match: "prefix" as const, status: "ready" as const },
  { href: "/backoffice/system", label: "System", match: "prefix" as const, status: "ready" as const },
];

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BackOfficeNav() {
  const pathname = usePathname() || "/backoffice";

  return (
    <nav
      aria-label="Founder Back Office"
      className="flex flex-wrap items-center gap-1 text-xs sm:gap-1.5"
    >
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href, link.match);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-2.5 py-2 font-semibold transition-colors sm:px-3 ${
              active
                ? "border border-[#2F80ED]/40 bg-[#2F80ED]/10 text-[#12324A]"
                : "border border-transparent text-[#5E7D93] hover:bg-white/70 hover:text-[#12324A]"
            }`}
          >
            {link.label}
            {link.status === "soon" ? (
              <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-[#7A96A8]">
                Soon
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
