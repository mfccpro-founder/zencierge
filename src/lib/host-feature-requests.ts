export const FEATURE_CATEGORIES = [
  { id: "housekeeping", label: "Housekeeping & Turnovers" },
  { id: "messaging", label: "Guest Messaging & AI" },
  { id: "pricing", label: "Pricing & Revenue" },
  { id: "disputes", label: "Disputes & AirCover" },
  { id: "access", label: "Smart Locks & Access" },
  { id: "other", label: "Other" },
] as const;

export type FeatureCategoryId = (typeof FEATURE_CATEGORIES)[number]["id"];

const LEGACY_CATEGORY: Record<string, FeatureCategoryId> = {
  limpieza: "housekeeping",
  finanzas: "pricing",
  huespedes: "messaging",
  reglas: "other",
  otro: "other",
};

export const FEATURE_STATUSES = [
  { id: "under_review", label: "Under Review" },
  { id: "planned", label: "Planned" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
] as const;

export type FeatureRequestStatus = (typeof FEATURE_STATUSES)[number]["id"];

export type HostFeatureRequest = {
  id: string;
  hostId: string;
  hostEmail: string;
  title: string;
  category: FeatureCategoryId;
  description: string;
  status: FeatureRequestStatus;
  createdAt: string;
};

export function isFeatureCategory(value: string): value is FeatureCategoryId {
  return FEATURE_CATEGORIES.some((item) => item.id === value);
}

export function isFeatureStatus(value: string): value is FeatureRequestStatus {
  return FEATURE_STATUSES.some((item) => item.id === value);
}

export function categoryLabel(id: string) {
  const normalized = LEGACY_CATEGORY[id] ?? id;
  return FEATURE_CATEGORIES.find((item) => item.id === normalized)?.label ?? id;
}

export function mapFeatureRequestRow(row: Record<string, unknown>): HostFeatureRequest {
  const status = String(row.status ?? "under_review");
  const rawCategory = String(row.category ?? "other");
  const category = LEGACY_CATEGORY[rawCategory] ?? rawCategory;
  return {
    id: String(row.id),
    hostId: String(row.host_id ?? row.user_id ?? ""),
    hostEmail: String(row.host_email ?? ""),
    title: String(row.title ?? ""),
    category: isFeatureCategory(category) ? category : "other",
    description: String(row.description ?? ""),
    status: isFeatureStatus(status) ? status : "under_review",
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}
