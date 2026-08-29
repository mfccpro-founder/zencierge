export const HOUSEKEEPING_PHOTO_CATEGORIES = [
  { id: "check_in", label: "Check-In" },
  { id: "check_out", label: "Check-Out" },
  { id: "damage_report", label: "Damage Report" },
] as const;

export type HousekeepingPhotoCategory = (typeof HOUSEKEEPING_PHOTO_CATEGORIES)[number]["id"];

export function parseHousekeepingPhotoCategory(value: string | null | undefined): HousekeepingPhotoCategory | null {
  const id = (value ?? "").trim();
  return HOUSEKEEPING_PHOTO_CATEGORIES.some((row) => row.id === id) ? (id as HousekeepingPhotoCategory) : null;
}

export const HOUSEKEEPING_STORAGE_BUCKET = "housekeeping";

export function housekeepingStoragePath(propertyId: string, reservationId: string, fileName: string) {
  const safeProperty = propertyId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeReservation = reservationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `properties/${safeProperty}/reservations/${safeReservation}/housekeeping/${safeName}`;
}
