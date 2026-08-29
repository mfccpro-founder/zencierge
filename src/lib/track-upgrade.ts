import type { ZenciergePlanId } from "@/lib/zencierge-plans";

export function trackUpgradeClick(planId: ZenciergePlanId, source: "landing" | "settings") {
  void fetch("/api/admin/funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "upgrade_click", planId, source }),
  }).catch(() => undefined);
}
