"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const TAB_ANCHORS: Record<string, string> = {
  "smart-locks": "smart-locks",
  "guest-qr": "guest-qr",
  turno: "turno-shifts",
  escrow: "escrow-payouts",
  supplies: "supply-tracking",
  verification: "id-verification",
};

function tabToAnchor(pathname: string, tab: string | null) {
  if (!tab) return "";
  if (tab === "all") {
    if (pathname.startsWith("/dashboard/housekeeping")) return "live-board";
    if (pathname.startsWith("/dashboard/guest-dna")) return "direct-bookings";
    if (pathname.startsWith("/dashboard/properties")) return "all-properties";
    return "";
  }
  return TAB_ANCHORS[tab] ?? "";
}

function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DashboardTabScrollInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  useEffect(() => {
    const fromTab = tabToAnchor(pathname, tab);
    const fromHash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const id = fromTab || fromHash;
    if (!id) return;
    const timer = window.setTimeout(() => scrollToAnchor(id), 120);
    return () => window.clearTimeout(timer);
  }, [pathname, tab]);

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (id) scrollToAnchor(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return null;
}

export function DashboardTabScroll() {
  return (
    <Suspense fallback={null}>
      <DashboardTabScrollInner />
    </Suspense>
  );
}
