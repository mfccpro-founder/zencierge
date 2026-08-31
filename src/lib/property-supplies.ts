export const SUPPLY_SKUS = [
  "toilet_paper",
  "towels",
  "coffee",
  "soap_shampoo",
  "trash_bags",
] as const;

export type SupplySku = (typeof SUPPLY_SKUS)[number];
export type SupplyUnit = "rolls" | "sets" | "bags" | "bottles" | "boxes";
export type StockLevel = "optimal" | "low" | "critical";
export type SupplyEventType = "turnover" | "restock" | "adjust";

export type SupplyCatalogItem = {
  sku: SupplySku;
  label: string;
  unit: SupplyUnit;
  defaultMinThreshold: number;
  defaultStock: number;
  restockQty: number;
};

export const SUPPLY_CATALOG: Record<SupplySku, SupplyCatalogItem> = {
  toilet_paper: {
    sku: "toilet_paper",
    label: "Toilet paper",
    unit: "rolls",
    defaultMinThreshold: 8,
    defaultStock: 16,
    restockQty: 12,
  },
  towels: {
    sku: "towels",
    label: "Towels",
    unit: "sets",
    defaultMinThreshold: 4,
    defaultStock: 8,
    restockQty: 4,
  },
  coffee: {
    sku: "coffee",
    label: "Coffee",
    unit: "bags",
    defaultMinThreshold: 2,
    defaultStock: 4,
    restockQty: 3,
  },
  soap_shampoo: {
    sku: "soap_shampoo",
    label: "Soap / shampoo",
    unit: "bottles",
    defaultMinThreshold: 4,
    defaultStock: 8,
    restockQty: 6,
  },
  trash_bags: {
    sku: "trash_bags",
    label: "Trash bags",
    unit: "boxes",
    defaultMinThreshold: 1,
    defaultStock: 3,
    restockQty: 2,
  },
};

export type PropertySupplyItem = {
  sku: SupplySku;
  label: string;
  unit: SupplyUnit;
  currentStock: number;
  minThreshold: number;
  restockQty: number;
};

export type PropertySupplySnapshot = {
  propertyId: string;
  items: PropertySupplyItem[];
  updatedAt: string;
  lastTurnoverAt: string | null;
  lastStaffName: string | null;
};

export type SupplyLogEntry = {
  id: string;
  propertyId: string;
  eventType: SupplyEventType;
  staffName: string | null;
  reservationId: string | null;
  missingSkus: SupplySku[];
  notes: string;
  createdAt: string;
};

export type ShoppingListLine = {
  propertyId: string;
  propertyName: string;
  sku: SupplySku;
  label: string;
  unit: SupplyUnit;
  currentStock: number;
  minThreshold: number;
  qtyToBuy: number;
  level: StockLevel;
};

export type TurnoverSupplyCount = {
  sku: SupplySku;
  remaining: number;
  missing: boolean;
};

export function isSupplySku(value: string): value is SupplySku {
  return (SUPPLY_SKUS as readonly string[]).includes(value);
}

export function clampStock(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 10) / 10);
}

export function stockLevel(currentStock: number, minThreshold: number): StockLevel {
  const current = clampStock(currentStock);
  const min = Math.max(0, minThreshold);
  if (current < min || current === 0) return "critical";
  if (current < min * 2) return "low";
  return "optimal";
}

export function qtyToBuy(item: PropertySupplyItem) {
  if (clampStock(item.currentStock) >= item.minThreshold) return 0;
  return Math.max(item.restockQty, clampStock(item.minThreshold - item.currentStock));
}

export function defaultSupplyItem(sku: SupplySku, overrides?: Partial<PropertySupplyItem>): PropertySupplyItem {
  const catalog = SUPPLY_CATALOG[sku];
  return {
    sku,
    label: catalog.label,
    unit: catalog.unit,
    currentStock: catalog.defaultStock,
    minThreshold: catalog.defaultMinThreshold,
    restockQty: catalog.restockQty,
    ...overrides,
  };
}

export function defaultSnapshot(propertyId: string, at = "1970-01-01T00:00:00.000Z"): PropertySupplySnapshot {
  return {
    propertyId,
    items: SUPPLY_SKUS.map((sku) => defaultSupplyItem(sku)),
    updatedAt: at,
    lastTurnoverAt: null,
    lastStaffName: null,
  };
}

/** Demo levels so the host board is not uniformly green on first load. */
export function seedSnapshotForProperty(propertyId: string): PropertySupplySnapshot {
  const base = defaultSnapshot(propertyId);
  if (propertyId === "prop-1" || propertyId.endsWith("1")) {
    return patchItems(base, {
      coffee: { currentStock: 1 },
      trash_bags: { currentStock: 0 },
    });
  }
  if (propertyId === "prop-2" || propertyId.endsWith("2")) {
    return patchItems(base, {
      towels: { currentStock: 6 },
    });
  }
  if (propertyId === "prop-3" || propertyId.endsWith("3")) {
    return patchItems(base, {
      towels: { currentStock: 2 },
      toilet_paper: { currentStock: 6 },
    });
  }
  if (propertyId === "prop-4" || propertyId.endsWith("4")) {
    return patchItems(base, {
      soap_shampoo: { currentStock: 1 },
    });
  }
  return base;
}

function patchItems(
  snapshot: PropertySupplySnapshot,
  patches: Partial<Record<SupplySku, Partial<PropertySupplyItem>>>,
): PropertySupplySnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      const patch = patches[item.sku];
      return patch ? { ...item, ...patch } : item;
    }),
  };
}

export function normalizeSnapshot(input: Partial<PropertySupplySnapshot> & { propertyId: string }): PropertySupplySnapshot {
  const fallback = seedSnapshotForProperty(input.propertyId);
  const bySku = new Map((input.items ?? []).map((item) => [item.sku, item]));
  return {
    propertyId: input.propertyId,
    updatedAt: input.updatedAt || fallback.updatedAt,
    lastTurnoverAt: input.lastTurnoverAt ?? fallback.lastTurnoverAt,
    lastStaffName: input.lastStaffName ?? fallback.lastStaffName,
    items: SUPPLY_SKUS.map((sku) => {
      const catalog = SUPPLY_CATALOG[sku];
      const row = bySku.get(sku);
      return defaultSupplyItem(sku, {
        currentStock: clampStock(row?.currentStock ?? fallback.items.find((item) => item.sku === sku)?.currentStock ?? catalog.defaultStock),
        minThreshold: clampStock(row?.minThreshold ?? catalog.defaultMinThreshold) || catalog.defaultMinThreshold,
        restockQty: clampStock(row?.restockQty ?? catalog.restockQty) || catalog.restockQty,
        label: catalog.label,
        unit: catalog.unit,
      });
    }),
  };
}

export function snapshotOverallLevel(snapshot: PropertySupplySnapshot): StockLevel {
  const levels = snapshot.items.map((item) => stockLevel(item.currentStock, item.minThreshold));
  if (levels.includes("critical")) return "critical";
  if (levels.includes("low")) return "low";
  return "optimal";
}

export function applyTurnoverCounts(
  snapshot: PropertySupplySnapshot,
  counts: TurnoverSupplyCount[],
  meta?: { staffName?: string | null; at?: string },
): { snapshot: PropertySupplySnapshot; missingSkus: SupplySku[] } {
  const missingSkus: SupplySku[] = [];
  const nextItems = snapshot.items.map((item) => {
    const count = counts.find((row) => row.sku === item.sku);
    if (!count) return item;
    if (count.missing) {
      missingSkus.push(item.sku);
      return { ...item, currentStock: 0 };
    }
    return { ...item, currentStock: clampStock(count.remaining) };
  });
  const at = meta?.at ?? new Date().toISOString();
  return {
    missingSkus,
    snapshot: {
      ...snapshot,
      items: nextItems,
      updatedAt: at,
      lastTurnoverAt: at,
      lastStaffName: meta?.staffName?.trim() || snapshot.lastStaffName,
    },
  };
}

export function restockItem(snapshot: PropertySupplySnapshot, sku: SupplySku): PropertySupplySnapshot {
  const at = new Date().toISOString();
  return {
    ...snapshot,
    updatedAt: at,
    items: snapshot.items.map((item) => {
      if (item.sku !== sku) return item;
      const target = Math.max(item.minThreshold * 2, item.currentStock + item.restockQty);
      return { ...item, currentStock: clampStock(target) };
    }),
  };
}

export function restockBelowThreshold(snapshot: PropertySupplySnapshot): PropertySupplySnapshot {
  let next = snapshot;
  for (const item of snapshot.items) {
    if (item.currentStock < item.minThreshold) {
      next = restockItem(next, item.sku);
    }
  }
  return { ...next, updatedAt: new Date().toISOString() };
}

export function buildShoppingList(
  snapshots: PropertySupplySnapshot[],
  names: Record<string, string>,
): ShoppingListLine[] {
  const lines: ShoppingListLine[] = [];
  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      const level = stockLevel(item.currentStock, item.minThreshold);
      if (level !== "critical") continue;
      const buy = qtyToBuy(item);
      if (buy <= 0) continue;
      lines.push({
        propertyId: snapshot.propertyId,
        propertyName: names[snapshot.propertyId] || snapshot.propertyId,
        sku: item.sku,
        label: item.label,
        unit: item.unit,
        currentStock: item.currentStock,
        minThreshold: item.minThreshold,
        qtyToBuy: buy,
        level,
      });
    }
  }
  return lines.sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.label.localeCompare(b.label));
}

export function mergeSnapshots(local: PropertySupplySnapshot[], remote: PropertySupplySnapshot[]) {
  const byId = new Map<string, PropertySupplySnapshot>();
  for (const row of remote) byId.set(row.propertyId, normalizeSnapshot(row));
  for (const row of local) {
    const current = byId.get(row.propertyId);
    if (!current || Date.parse(row.updatedAt) >= Date.parse(current.updatedAt)) {
      byId.set(row.propertyId, normalizeSnapshot(row));
    }
  }
  return [...byId.values()];
}
