export type HostNavMatch = "exact" | "prefix";

export type HostNavItem = {
  /** Stable id for guide content and tests. Distinct per query-tab route. */
  id: string;
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
      { id: "overview", href: "/dashboard", label: "Overview", match: "exact" },
      { id: "calendar", href: "/dashboard/calendar", label: "Calendar", match: "prefix" },
    ],
  },
  {
    id: "financials",
    label: "Financials",
    items: [
      { id: "payouts-noi", href: "/dashboard/financials", label: "Payouts & NOI", match: "prefix" },
      { id: "chargeback-shield", href: "/dashboard/chargeback-shield", label: "Chargeback Shield", match: "prefix", nested: true },
      { id: "dispute-dossier", href: "/dashboard/dispute-dossier", label: "Dispute Dossier", match: "prefix", nested: true },
    ],
  },
  {
    id: "properties",
    label: "Properties & Smart Locks",
    items: [
      { id: "properties-access", href: "/dashboard/properties", label: "Properties & access", match: "prefix" },
    ],
  },
  {
    id: "elena",
    label: "AI Assistant",
    items: [
      { id: "elena-voice", href: "/dashboard/voice-agent", label: "Elena Voice", match: "prefix" },
      { id: "guest-qr", href: "/dashboard/voice-agent?tab=guest-qr", label: "Guest QR", match: "prefix", tab: "guest-qr" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { id: "housekeeping", href: "/dashboard/housekeeping", label: "Housekeeping", match: "prefix" },
      { id: "photo-reports", href: "/dashboard/housekeeping?tab=reports", label: "Photo reports", match: "prefix", tab: "reports" },
      { id: "supplies", href: "/dashboard/housekeeping?tab=supplies", label: "Supplies", match: "prefix", tab: "supplies" },
      { id: "team-cleaners", href: "/dashboard/housekeeping?tab=team", label: "Team & Cleaners Access", match: "prefix", tab: "team" },
      { id: "neighbor-shield", href: "/dashboard/neighbor-shield", label: "NeighborShield Emergencies", match: "prefix" },
      { id: "guest-dna", href: "/dashboard/guest-dna", label: "Guest DNA", match: "prefix" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    items: [
      { id: "laws", href: "/dashboard/laws", label: "Airbnb Regulations & Laws", match: "prefix" },
    ],
  },
  {
    id: "guide",
    label: "User Guide",
    standalone: true,
    items: [{ id: "user-guide", href: "/dashboard/guide", label: "User Guide", match: "prefix" }],
  },
  {
    id: "settings",
    label: "Settings",
    standalone: true,
    items: [{ id: "settings", href: "/dashboard/settings", label: "Settings", match: "exact" }],
  },
];

export const SETTINGS_PATH = "/dashboard/settings";
export const USER_GUIDE_PATH = "/dashboard/guide";

export function flattenHostNavItems() {
  return HOST_NAV_SECTIONS.flatMap((section) => section.items);
}

export function isUserGuideNavItem(item: HostNavItem) {
  return item.id === "user-guide" || normalizePathname(new URL(item.href, "https://zencierge.local").pathname) === USER_GUIDE_PATH;
}

/** Routed sidebar items documented in the User Guide (excludes the Guide itself). */
export function guideableHostNavItems() {
  return flattenHostNavItems().filter((item) => !isUserGuideNavItem(item));
}

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
