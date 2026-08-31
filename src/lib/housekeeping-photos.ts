export const HOUSEKEEPING_REPORT_CATEGORIES = [
  { id: "cleaned_ready", label: "Cleaned & Ready" },
  { id: "maintenance_issue", label: "Maintenance Issue" },
  { id: "damage_found", label: "Damage Found" },
] as const;

export const HOUSEKEEPING_PHOTO_CATEGORIES = [
  ...HOUSEKEEPING_REPORT_CATEGORIES,
  { id: "check_in", label: "Check-In" },
  { id: "check_out", label: "Check-Out" },
  { id: "damage_report", label: "Damage Report" },
] as const;

export type HousekeepingPhotoCategory = (typeof HOUSEKEEPING_PHOTO_CATEGORIES)[number]["id"];
export type HousekeepingReportCategory = (typeof HOUSEKEEPING_REPORT_CATEGORIES)[number]["id"];

export function parseHousekeepingPhotoCategory(value: string | null | undefined): HousekeepingPhotoCategory | null {
  const id = (value ?? "").trim();
  return HOUSEKEEPING_PHOTO_CATEGORIES.some((row) => row.id === id) ? (id as HousekeepingPhotoCategory) : null;
}

export function parseHousekeepingReportCategory(value: string | null | undefined): HousekeepingReportCategory | null {
  const id = (value ?? "").trim();
  return HOUSEKEEPING_REPORT_CATEGORIES.some((row) => row.id === id) ? (id as HousekeepingReportCategory) : null;
}

export function housekeepingCategoryLabel(id: string) {
  return HOUSEKEEPING_PHOTO_CATEGORIES.find((row) => row.id === id)?.label ?? id;
}

export const HOUSEKEEPING_STORAGE_BUCKET = "housekeeping";

export function housekeepingStoragePath(propertyId: string, reservationId: string, fileName: string) {
  const safeProperty = propertyId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeReservation = reservationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `properties/${safeProperty}/reservations/${safeReservation}/housekeeping/${safeName}`;
}

export type HousekeepingReportPhoto = {
  id: string;
  imageUrl: string;
  storagePath: string;
};

export type HousekeepingReport = {
  id: string;
  propertyId: string;
  propertyName: string;
  propertyCity: string;
  reservationId: string;
  category: HousekeepingPhotoCategory;
  notes: string;
  staffName: string | null;
  createdAt: string;
  photos: HousekeepingReportPhoto[];
};

export type HostAlert = {
  id: string;
  kind: "housekeeping_report";
  title: string;
  body: string;
  href: string;
  createdAt: string;
  reportId: string;
  propertyId: string;
};
