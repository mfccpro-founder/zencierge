import type { NavId } from "@/lib/dashboard-data";
import { isSettingsPathname, normalizePathname } from "@/lib/host-nav";

export function isDashboardNavActive(pathname: string, href: string, match: "exact" | "prefix") {
  const path = normalizePathname(pathname);
  const target = normalizePathname(href);
  if (match === "exact") return path === target;
  return path === target || path.startsWith(`${target}/`);
}

export function dashboardTabFromPath(pathname: string): NavId {
  const path = normalizePathname(pathname);
  if (path === "/dashboard/properties" || path.startsWith("/dashboard/properties/")) return "properties";
  if (path === "/dashboard/financials" || path.startsWith("/dashboard/financials/")) return "finances";
  if (path === "/dashboard/voice-agent" || path.startsWith("/dashboard/voice-agent/")) return "voice";
  if (isSettingsPathname(path)) return "settings";
  if (path === "/dashboard/calendar" || path.startsWith("/dashboard/calendar/")) return "calendar";
  return "overview";
}
