export type ZenciergePlanId = "starter" | "pro" | "agency";

export type ZenciergePlan = {
  id: ZenciergePlanId;
  name: string;
  monthlyUsd: number;
  maxProperties: number;
};

export const ZENCIERGE_PLANS: Record<ZenciergePlanId, ZenciergePlan> = {
  starter: { id: "starter", name: "Starter", monthlyUsd: 29, maxProperties: 1 },
  pro: { id: "pro", name: "Pro Superhost", monthlyUsd: 79, maxProperties: 4 },
  agency: { id: "agency", name: "Co-Host Agency", monthlyUsd: 199, maxProperties: Number.POSITIVE_INFINITY },
};

export function parsePlanId(value: unknown): ZenciergePlanId | null {
  if (value === "starter" || value === "pro" || value === "agency") return value;
  return null;
}

export function planFromMetadata(meta: Record<string, unknown> | null | undefined): ZenciergePlanId {
  return parsePlanId(meta?.plan) ?? "starter";
}
