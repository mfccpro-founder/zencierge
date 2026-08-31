import {
  mergeSnapshots,
  normalizeSnapshot,
  seedSnapshotForProperty,
  type PropertySupplySnapshot,
  type SupplyLogEntry,
} from "@/lib/property-supplies";

export const SUPPLIES_STORAGE_KEY = "zencierge.property-supplies.v1";
export const SUPPLIES_LOGS_STORAGE_KEY = "zencierge.property-supply-logs.v1";
export const SUPPLIES_UPDATED_EVENT = "zencierge-supplies-updated";

type LocalBundle = {
  snapshots: PropertySupplySnapshot[];
  logs: SupplyLogEntry[];
};

export function readLocalSupplies(): LocalBundle {
  if (typeof window === "undefined") return { snapshots: [], logs: [] };
  try {
    const snapshots = JSON.parse(window.localStorage.getItem(SUPPLIES_STORAGE_KEY) || "[]") as PropertySupplySnapshot[];
    const logs = JSON.parse(window.localStorage.getItem(SUPPLIES_LOGS_STORAGE_KEY) || "[]") as SupplyLogEntry[];
    return {
      snapshots: Array.isArray(snapshots) ? snapshots.map((row) => normalizeSnapshot(row)) : [],
      logs: Array.isArray(logs) ? logs : [],
    };
  } catch {
    return { snapshots: [], logs: [] };
  }
}

export function writeLocalSupplies(bundle: LocalBundle) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SUPPLIES_STORAGE_KEY, JSON.stringify(bundle.snapshots));
  window.localStorage.setItem(SUPPLIES_LOGS_STORAGE_KEY, JSON.stringify(bundle.logs.slice(0, 50)));
  window.dispatchEvent(new Event(SUPPLIES_UPDATED_EVENT));
}

export function ensureSnapshotsForProperties(
  propertyIds: string[],
  existing: PropertySupplySnapshot[],
): PropertySupplySnapshot[] {
  const byId = new Map(existing.map((row) => [row.propertyId, row]));
  return propertyIds.map((id) => byId.get(id) ?? seedSnapshotForProperty(id));
}

export function upsertLocalSnapshot(snapshot: PropertySupplySnapshot, log?: SupplyLogEntry) {
  const current = readLocalSupplies();
  const snapshots = mergeSnapshots(
    [normalizeSnapshot(snapshot)],
    current.snapshots.filter((row) => row.propertyId !== snapshot.propertyId),
  );
  const logs = log ? [log, ...current.logs].slice(0, 50) : current.logs;
  writeLocalSupplies({ snapshots, logs });
  return { snapshots, logs };
}
