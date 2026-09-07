export const LOCAL_GUIDE_CATEGORIES = [
  "restaurant",
  "pharmacy",
  "grocery",
  "hospital",
  "gas",
  "attraction",
] as const;

export type LocalGuideCategory = (typeof LOCAL_GUIDE_CATEGORIES)[number];

export type LocalGuidePublicResult = {
  id: string;
  category: LocalGuideCategory;
  businessName: string;
  distanceMiles: number | null;
  hostNote: string;
  websiteOrMapsLink: string;
  source: "host";
};

export type LocalGuideHostRow = LocalGuidePublicResult & {
  propertyId: string;
  active: boolean;
  sortOrder: number;
};

export const LOCAL_GUIDE_RADIUS_MILES: Record<LocalGuideCategory, number> = {
  restaurant: 3,
  pharmacy: 3,
  grocery: 3,
  attraction: 3,
  gas: 5,
  hospital: 10,
};

export const LOCAL_GUIDE_LIMITS = {
  businessName: 80,
  hostNote: 240,
  link: 500,
  propertyId: 80,
} as const;

export function isLocalGuideCategory(value: string): value is LocalGuideCategory {
  return (LOCAL_GUIDE_CATEGORIES as readonly string[]).includes(value);
}

export function localGuideRadiusMiles(category: LocalGuideCategory) {
  return LOCAL_GUIDE_RADIUS_MILES[category];
}

export function categoriesForNearbyKind(kind: string): LocalGuideCategory[] {
  if (isLocalGuideCategory(kind)) return [kind];
  if (kind === "nearby") return ["restaurant", "grocery", "attraction"];
  return [];
}

export function withinLocalGuideRadius(category: LocalGuideCategory, miles: number | null) {
  if (miles == null || !Number.isFinite(miles)) return true;
  if (miles < 0) return false;
  return miles <= LOCAL_GUIDE_RADIUS_MILES[category];
}

export function isMissingLocalGuideTable(error: { code?: string; message?: string } | null | undefined) {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("property_local_guide") && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"))
  );
}

export function sanitizeGuideText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function sanitizeGuideLink(value: unknown) {
  const raw = sanitizeGuideText(value, LOCAL_GUIDE_LIMITS.link);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().slice(0, LOCAL_GUIDE_LIMITS.link);
  } catch {
    return "";
  }
}

export function parseGuideDistance(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 10) / 10;
}

export function hostOwnsRequestedProperty(ownedIds: string[], propertyId: string) {
  return Boolean(propertyId) && ownedIds.includes(propertyId);
}

export function nearbyFromHostOrGoogle(hostResults: LocalGuidePublicResult[]) {
  const host = hostResults.slice(0, 3);
  if (host.length) {
    return { source: "host" as const, hostResults: host, fetchGoogle: false as const };
  }
  return { source: "google" as const, fetchGoogle: true as const };
}

export function authorizeLocalGuideWrite(
  userId: string | null | undefined,
  ownedPropertyIds: string[],
  propertyId: string,
) {
  if (!userId) return "unauthorized" as const;
  if (!propertyId || !hostOwnsRequestedProperty(ownedPropertyIds, propertyId)) return "forbidden" as const;
  return "ok" as const;
}

export function selectGuestGuideRows(rows: LocalGuideHostRow[], kind: string): LocalGuidePublicResult[] {
  const categories = categoriesForNearbyKind(kind);
  return rows
    .filter(
      (row) =>
        row.active &&
        categories.includes(row.category) &&
        row.businessName.trim() &&
        withinLocalGuideRadius(row.category, row.distanceMiles),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.businessName.localeCompare(b.businessName))
    .slice(0, 3)
    .map((row) => ({
      id: row.id,
      category: row.category,
      businessName: row.businessName,
      distanceMiles: row.distanceMiles,
      hostNote: row.hostNote,
      websiteOrMapsLink: row.websiteOrMapsLink,
      source: "host" as const,
    }));
}

export function milesSpeech(miles: number | null, lang: "en" | "es") {
  if (miles == null) return "";
  const n = Math.round(miles * 10) / 10;
  if (lang === "es") {
    if (n === 0.5) return "a media milla";
    if (n === 1) return "a una milla";
    return `a ${String(n).replace(/\.0$/, "")} millas`;
  }
  if (n === 0.5) return "half a mile away";
  if (n === 1) return "one mile away";
  return `${String(n).replace(/\.0$/, "")} miles away`;
}

export function formatHostGuideSpeech(places: LocalGuidePublicResult[], lang: "en" | "es") {
  const top = places.slice(0, 3).filter((row) => row.businessName.trim());
  if (!top.length) return "";
  const parts = top.map((row) => {
    const name = row.businessName.trim();
    const miles = milesSpeech(row.distanceMiles, lang);
    return miles ? `${name}, ${miles}` : name;
  });
  const list =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? lang === "es"
          ? `${parts[0]}, y ${parts[1]}`
          : `${parts[0]}, and ${parts[1]}`
        : lang === "es"
          ? `${parts[0]}, ${parts[1]} y ${parts[2]}`
          : `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
  return lang === "es" ? `Tu anfitrión recomienda ${list}.` : `Your host recommends ${list}.`;
}

export const LOCAL_GUIDE_WRITE_KEYS = [
  "id",
  "propertyId",
  "category",
  "businessName",
  "distanceMiles",
  "hostNote",
  "websiteOrMapsLink",
  "active",
  "sortOrder",
] as const;

export type LocalGuideWrite = {
  propertyId: string;
  category: LocalGuideCategory;
  businessName: string;
  distanceMiles: number | null;
  hostNote: string;
  websiteOrMapsLink: string;
  active: boolean;
  sortOrder: number;
};

export function sanitizeLocalGuideWrite(input: Record<string, unknown>): { error: "invalid" | "invalid_link" | "invalid_category" | "invalid_name" | "invalid_distance" } | { error: null; value: LocalGuideWrite } {
  const propertyId = sanitizeGuideText(input.propertyId, LOCAL_GUIDE_LIMITS.propertyId);
  const categoryRaw = typeof input.category === "string" ? input.category.trim() : "";
  const businessName = sanitizeGuideText(input.businessName, LOCAL_GUIDE_LIMITS.businessName);
  const distance = parseGuideDistance(input.distanceMiles);
  const hostNote = sanitizeGuideText(input.hostNote, LOCAL_GUIDE_LIMITS.hostNote);
  const websiteOrMapsLink = sanitizeGuideLink(input.websiteOrMapsLink);
  if (typeof input.websiteOrMapsLink === "string" && input.websiteOrMapsLink.trim() && !websiteOrMapsLink) {
    return { error: "invalid_link" };
  }
  if (!propertyId) return { error: "invalid" };
  if (!isLocalGuideCategory(categoryRaw)) return { error: "invalid_category" };
  if (!businessName) return { error: "invalid_name" };
  if (distance === "invalid") return { error: "invalid_distance" };
  const active = input.active === undefined ? true : Boolean(input.active);
  const sortOrderRaw = input.sortOrder === undefined || input.sortOrder === null || input.sortOrder === "" ? 0 : Number(input.sortOrder);
  if (!Number.isFinite(sortOrderRaw)) return { error: "invalid" };
  return {
    error: null,
    value: {
      propertyId,
      category: categoryRaw,
      businessName,
      distanceMiles: distance,
      hostNote,
      websiteOrMapsLink,
      active,
      sortOrder: Math.trunc(sortOrderRaw),
    },
  };
}

export function hasUnknownGuideKeys(body: object, extra: string[] = []) {
  const allowed = new Set<string>([...LOCAL_GUIDE_WRITE_KEYS, ...extra]);
  return Object.keys(body).some((key) => !allowed.has(key));
}
