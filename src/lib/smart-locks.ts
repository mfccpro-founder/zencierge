import type { Property } from "@/lib/dashboard-data";

export type LockVendor = "yale" | "august" | "schlage" | "seam";
export type LockStatus = "online" | "offline" | "jammed";

export type SmartLockItem = {
  id: string;
  propertyId: string;
  propertyName: string;
  lockName: string;
  brand: string;
  vendor: LockVendor;
  batteryLevel: number;
  status: LockStatus;
  doorCode: string;
};

export const LOCK_VENDOR_META: Record<LockVendor, { label: string; lockName: string }> = {
  yale: { label: "Yale", lockName: "Yale Assure · Seam" },
  august: { label: "August", lockName: "August Wi-Fi · Seam" },
  schlage: { label: "Schlage", lockName: "Schlage Encode · Seam" },
  seam: { label: "Seam", lockName: "Seam Connect" },
};

export function inferLockVendor(smartlock: string): LockVendor {
  const value = smartlock.toLowerCase();
  if (value.includes("august")) return "august";
  if (value.includes("schlage")) return "schlage";
  if (value.includes("seam") && !value.includes("yale")) return "seam";
  return "yale";
}

export function lockBatteryPct(propertyId: string) {
  let sum = 0;
  for (let index = 0; index < propertyId.length; index += 1) {
    sum += propertyId.charCodeAt(index);
  }
  return 48 + (sum % 50);
}

export function lockStatusFor(smartlock: string, batteryLevel: number): LockStatus {
  if (!smartlock.trim()) return "offline";
  if (batteryLevel < 20) return "jammed";
  return "online";
}

export function lockBrandLabel(smartlock: string) {
  const head = smartlock.split("·")[0]?.trim();
  return head || LOCK_VENDOR_META[inferLockVendor(smartlock)].label;
}

export function lockDeviceName(smartlock: string) {
  const parts = smartlock.split("·").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return parts.slice(1).join(" · ");
  return parts[0] || "Front door";
}

export function smartLockItemFromProperty(property: Property): SmartLockItem {
  const batteryLevel = lockBatteryPct(property.id);
  const vendor = inferLockVendor(property.smartlock);
  return {
    id: `lock-${property.id}`,
    propertyId: property.id,
    propertyName: property.name,
    lockName: lockDeviceName(property.smartlock),
    brand: lockBrandLabel(property.smartlock),
    vendor,
    batteryLevel,
    status: lockStatusFor(property.smartlock, batteryLevel),
    doorCode: property.doorCode,
  };
}
