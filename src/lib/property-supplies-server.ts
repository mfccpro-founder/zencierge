import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { fetchListings } from "@/lib/supabase-listings";
import {
  logFromRow,
  snapshotToRows,
  snapshotsFromRows,
  type PropertySupplyLogRow,
  type PropertySupplyRow,
} from "@/lib/property-supplies-db";
import {
  normalizeSnapshot,
  seedSnapshotForProperty,
  type PropertySupplySnapshot,
  type SupplyLogEntry,
} from "@/lib/property-supplies";

export function tryAdmin() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return null;
  }
}

export async function loadSupplyBoard(propertyIds?: string[]) {
  const listings = await fetchListings();
  const ids = propertyIds?.length ? propertyIds : listings.properties.map((property) => property.id);
  const names = Object.fromEntries(listings.properties.map((property) => [property.id, property.name]));
  const admin = tryAdmin();
  let remote: PropertySupplySnapshot[] = [];
  let logs: SupplyLogEntry[] = [];
  let persisted: "supabase" | "local" = "local";

  if (admin) {
    const { data, error } = await admin.from("property_supplies").select("*");
    if (!error && data) {
      remote = snapshotsFromRows(data as PropertySupplyRow[]);
      persisted = "supabase";
    }
    const logRes = await admin
      .from("property_supply_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40);
    if (!logRes.error && logRes.data) {
      logs = (logRes.data as PropertySupplyLogRow[]).map(logFromRow);
    }
  }

  const snapshots = ids.map((id) => {
    const found = remote.find((row) => row.propertyId === id);
    return found ? normalizeSnapshot(found) : seedSnapshotForProperty(id);
  });

  return { snapshots, logs, names, persisted, properties: listings.properties };
}

export async function saveSnapshot(snapshot: PropertySupplySnapshot) {
  const admin = tryAdmin();
  if (!admin) return false;
  const { error } = await admin.from("property_supplies").upsert(snapshotToRows(normalizeSnapshot(snapshot)));
  return !error;
}

export async function saveSupplyLog(entry: SupplyLogEntry) {
  const admin = tryAdmin();
  if (!admin) return false;
  const { error } = await admin.from("property_supply_logs").insert({
    id: entry.id || randomUUID(),
    property_id: entry.propertyId,
    event_type: entry.eventType,
    staff_name: entry.staffName,
    reservation_id: entry.reservationId,
    payload: { missingSkus: entry.missingSkus, notes: entry.notes },
    created_at: entry.createdAt,
  });
  return !error;
}

export function newSupplyLog(partial: Omit<SupplyLogEntry, "id" | "createdAt"> & { id?: string; createdAt?: string }): SupplyLogEntry {
  return {
    id: partial.id || randomUUID(),
    createdAt: partial.createdAt || new Date().toISOString(),
    propertyId: partial.propertyId,
    eventType: partial.eventType,
    staffName: partial.staffName,
    reservationId: partial.reservationId,
    missingSkus: partial.missingSkus,
    notes: partial.notes,
  };
}
