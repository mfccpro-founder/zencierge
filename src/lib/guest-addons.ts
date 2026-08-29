export type GuestAddonId = "early_checkin" | "mid_stay_clean";

export const GUEST_ADDONS: Record<GuestAddonId, { name: string; usd: number; description: string }> = {
  early_checkin: {
    name: "Early check-in",
    usd: 49,
    description: "Arrive before standard check-in when the unit is ready.",
  },
  mid_stay_clean: {
    name: "Mid-stay cleaning",
    usd: 85,
    description: "Fresh linens, towels, and a full mid-stay turnover.",
  },
};

export function parseGuestAddonId(value: unknown): GuestAddonId | null {
  if (value === "early_checkin" || value === "mid_stay_clean") return value;
  return null;
}
