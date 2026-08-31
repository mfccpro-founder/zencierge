export type HostNavMatch = "exact" | "prefix";

export type HostNavItem = {
  href: string;
  label: string;
  match: HostNavMatch;
  /** When set, the item is active only if `?tab=` matches. */
  tab?: string;
  /** Indent as a child row under the section’s primary page. */
  nested?: boolean;
};

export type HostNavSection = {
  id: string;
  label: string;
  items: HostNavItem[];
  /** Single row in the sidebar, not an accordion group. */
  standalone?: boolean;
};

export const HOST_NAV_SECTIONS: HostNavSection[] = [
  {
    id: "command",
    label: "Command Center",
    items: [
      { href: "/dashboard", label: "Overview", match: "exact" },
      { href: "/dashboard/calendar", label: "Calendar", match: "prefix" },
    ],
  },
  {
    id: "financials",
    label: "Financials",
    items: [
      { href: "/dashboard/financials", label: "Payouts & NOI", match: "prefix" },
      { href: "/dashboard/chargeback-shield", label: "Chargeback Shield", match: "prefix", nested: true },
      { href: "/dashboard/dispute-dossier", label: "Dispute Dossier", match: "prefix", nested: true },
    ],
  },
  {
    id: "properties",
    label: "Properties & Smart Locks",
    items: [
      { href: "/dashboard/properties", label: "Properties & access", match: "prefix" },
    ],
  },
  {
    id: "elena",
    label: "AI Assistant",
    items: [
      { href: "/dashboard/voice-agent", label: "Elena Voice", match: "prefix" },
      { href: "/dashboard/voice-agent?tab=guest-qr", label: "Guest QR", match: "prefix", tab: "guest-qr" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/dashboard/housekeeping", label: "Housekeeping", match: "prefix" },
      { href: "/dashboard/housekeeping?tab=reports", label: "Photo reports", match: "prefix", tab: "reports" },
      { href: "/dashboard/housekeeping?tab=supplies", label: "Supplies", match: "prefix", tab: "supplies" },
      { href: "/dashboard/housekeeping?tab=team", label: "Team & Cleaners Access", match: "prefix", tab: "team" },
      { href: "/dashboard/neighbor-shield", label: "NeighborShield Emergencies", match: "prefix" },
      { href: "/dashboard/guest-dna", label: "Guest DNA", match: "prefix" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    items: [
      { href: "/dashboard/laws", label: "Airbnb Regulations & Laws", match: "prefix" },
      { href: "/dashboard/guide", label: "User Guide", match: "prefix" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    standalone: true,
    items: [{ href: "/dashboard/settings", label: "Settings", match: "exact" }],
  },
];

export const SETTINGS_PATH = "/dashboard/settings";

/** Strip query/hash and a trailing slash so `/dashboard/settings/` does not leak into prefix checks. */
export function normalizePathname(pathname: string) {
  const path = pathname.split("?")[0]?.split("#")[0] ?? "";
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export function isSettingsPathname(pathname: string | null | undefined) {
  return normalizePathname(pathname ?? "") === SETTINGS_PATH;
}

export function hostNavSectionIdForPath(pathname: string, tab: string | null) {
  for (const section of HOST_NAV_SECTIONS) {
    if (section.items.some((item) => isHostNavItemActive(pathname, tab, item))) {
      return section.id;
    }
  }
  return HOST_NAV_SECTIONS[0]?.id ?? "command";
}

function pathMatches(pathname: string, hrefPath: string, match: HostNavMatch) {
  const path = normalizePathname(pathname);
  const href = normalizePathname(hrefPath);
  if (match === "exact") return path === href;
  return path === href || path.startsWith(`${href}/`);
}

export function isHostNavItemActive(pathname: string, tab: string | null, item: HostNavItem) {
  const url = new URL(item.href, "https://zencierge.local");
  if (normalizePathname(url.pathname) === SETTINGS_PATH) {
    return isSettingsPathname(pathname);
  }
  if (!pathMatches(pathname, url.pathname, item.match)) return false;

  const wantedTab = item.tab ?? url.searchParams.get("tab");
  if (wantedTab) return tab === wantedTab;

  const siblingTabs = HOST_NAV_SECTIONS.flatMap((section) => section.items)
    .filter((other) => {
      const otherPath = new URL(other.href, "https://zencierge.local").pathname;
      return otherPath === url.pathname && Boolean(other.tab || new URL(other.href, "https://zencierge.local").searchParams.get("tab"));
    })
    .map((other) => other.tab ?? new URL(other.href, "https://zencierge.local").searchParams.get("tab"));

  if (siblingTabs.length && siblingTabs.includes(tab)) return false;
  return true;
}
