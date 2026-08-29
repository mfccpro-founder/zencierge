import type { NavId } from "@/lib/dashboard-data";

export function isDashboardNavActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function dashboardTabFromPath(pathname: string): NavId {
  if (pathname.startsWith("/dashboard/properties")) return "properties";
  if (pathname.startsWith("/dashboard/financials")) return "finances";
  if (pathname.startsWith("/dashboard/voice-agent")) return "voice";
  if (pathname.startsWith("/dashboard/settings")) return "settings";
  if (pathname.startsWith("/dashboard/calendar")) return "calendar";
  return "overview";
}
