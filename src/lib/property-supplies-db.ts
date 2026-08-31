import { supabase } from "@/lib/supabase";
import { hasSupabaseEnv } from "@/lib/supabase-config";
import {
  normalizeSnapshot,
  type PropertySupplySnapshot,
  type SupplyEventType,
  type SupplyLogEntry,
  type SupplySku,
} from "@/lib/property-supplies";

export type PropertySupplyRow = {
  property_id: string;
  sku: string;
  current_stock: number;
  min_threshold: number;
  unit: string;
  restock_qty: number;
  updated_at: string;
  last_turnover_at?: string | null;
  last_staff_name?: string | null;
};

export type PropertySupplyLogRow = {
  id: string;
  property_id: string;
  event_type: string;
  staff_name: string | null;
  reservation_id: string | null;
  payload: {
    missingSkus?: SupplySku[];
    notes?: string;
  } | null;
  created_at: string;
};

export function snapshotsFromRows(rows: PropertySupplyRow[]): PropertySupplySnapshot[] {
  const grouped = new Map<string, PropertySupplyRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.property_id) ?? [];
    list.push(row);
    grouped.set(row.property_id, list);
  }
  return [...grouped.entries()].map(([propertyId, items]) =>
    normalizeSnapshot({
      propertyId,
      updatedAt: items.reduce((latest, row) => (row.updated_at > latest ? row.updated_at : latest), items[0]?.updated_at ?? new Date().toISOString()),
      lastTurnoverAt: items.find((row) => row.last_turnover_at)?.last_turnover_at ?? null,
      lastStaffName: items.find((row) => row.last_staff_name)?.last_staff_name ?? null,
      items: items.map((row) => ({
        sku: row.sku as SupplySku,
        label: row.sku,
        unit: row.unit as PropertySupplySnapshot["items"][number]["unit"],
        currentStock: Number(row.current_stock),
        minThreshold: Number(row.min_threshold),
        restockQty: Number(row.restock_qty),
      })),
    }),
  );
}

export function snapshotToRows(snapshot: PropertySupplySnapshot): PropertySupplyRow[] {
  return snapshot.items.map((item) => ({
    property_id: snapshot.propertyId,
    sku: item.sku,
    current_stock: item.currentStock,
    min_threshold: item.minThreshold,
    unit: item.unit,
    restock_qty: item.restockQty,
    updated_at: snapshot.updatedAt,
    last_turnover_at: snapshot.lastTurnoverAt,
    last_staff_name: snapshot.lastStaffName,
  }));
}

export function logFromRow(row: PropertySupplyLogRow): SupplyLogEntry {
  return {
    id: row.id,
    propertyId: row.property_id,
    eventType: (row.event_type as SupplyEventType) || "adjust",
    staffName: row.staff_name,
    reservationId: row.reservation_id,
    missingSkus: row.payload?.missingSkus ?? [],
    notes: row.payload?.notes ?? "",
    createdAt: row.created_at,
  };
}

export async function fetchSupplySnapshotsFromSupabase(): Promise<{
  snapshots: PropertySupplySnapshot[];
  logs: SupplyLogEntry[];
  available: boolean;
}> {
  if (!hasSupabaseEnv()) {
    return { snapshots: [], logs: [], available: false };
  }
  const supplies = await supabase.from("property_supplies").select("*");
  if (supplies.error) {
    return { snapshots: [], logs: [], available: false };
  }
  const logs = await supabase
    .from("property_supply_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(40);
  return {
    snapshots: snapshotsFromRows((supplies.data ?? []) as PropertySupplyRow[]),
    logs: ((logs.data ?? []) as PropertySupplyLogRow[]).map(logFromRow),
    available: true,
  };
}

export async function upsertSupplySnapshotToSupabase(snapshot: PropertySupplySnapshot) {
  if (!hasSupabaseEnv()) return false;
  const { error } = await supabase.from("property_supplies").upsert(snapshotToRows(snapshot));
  return !error;
}

export async function insertSupplyLogToSupabase(entry: Omit<SupplyLogEntry, "id" | "createdAt"> & { id?: string; createdAt?: string }) {
  if (!hasSupabaseEnv()) return false;
  const { error } = await supabase.from("property_supply_logs").insert({
    id: entry.id,
    property_id: entry.propertyId,
    event_type: entry.eventType,
    staff_name: entry.staffName,
    reservation_id: entry.reservationId,
    payload: { missingSkus: entry.missingSkus, notes: entry.notes },
    created_at: entry.createdAt,
  });
  return !error;
}
