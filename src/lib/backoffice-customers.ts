import type { AdminSubscriberRow, PaymentState } from "@/lib/admin-billing";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

export type BackOfficeCustomerFilter =
  | "all"
  | "paying"
  | "trial"
  | "past_due"
  | "canceled"
  | "complimentary";

export function isTrialCustomer(row: AdminSubscriberRow) {
  return row.trialActive === true;
}

export function customerMatchesFilter(row: AdminSubscriberRow, filter: BackOfficeCustomerFilter) {
  switch (filter) {
    case "all":
      return true;
    case "paying":
      return row.paymentState === "al_dia" && !row.complimentaryActive && !row.isLifetimeFree && !row.trialActive;
    case "past_due":
      return row.paymentState === "moroso";
    case "canceled":
      return row.paymentState === "cancelado";
    case "trial":
      return isTrialCustomer(row);
    case "complimentary":
      return row.complimentaryActive;
  }
}

export function customerSearchHaystack(row: AdminSubscriberRow) {
  return `${row.fullName ?? ""} ${row.email}`.toLowerCase();
}

export function filterBackOfficeCustomers(
  rows: readonly AdminSubscriberRow[],
  input: { query: string; filter: BackOfficeCustomerFilter },
) {
  const needle = input.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (!customerMatchesFilter(row, input.filter)) return false;
    if (!needle) return true;
    return customerSearchHaystack(row).includes(needle);
  });
}

export function backOfficeCustomerStatusLabel(row: AdminSubscriberRow) {
  if (row.isLifetimeFree) return "Lifetime VIP";
  if (row.complimentaryActive) return "Complimentary";
  if (isTrialCustomer(row)) return "14-Day Trial";
  const map: Record<PaymentState, string> = {
    al_dia: "Paying",
    moroso: "Past Due",
    cancelado: "Canceled",
    sin_suscripcion: "No Subscription",
  };
  return map[row.paymentState];
}

export function findBackOfficeCustomer(
  rows: readonly AdminSubscriberRow[],
  userId: string,
): AdminSubscriberRow | null {
  return rows.find((row) => row.userId === userId) ?? null;
}

/** Live counts from `properties.host_id`. Missing keys mean 0 owned properties. */
export type PropertyCountByHostId = Readonly<Record<string, number>>;

export function propertyCountForHost(
  counts: PropertyCountByHostId | null | undefined,
  hostId: string,
): number {
  if (!counts) return 0;
  return counts[hostId] ?? 0;
}

export function formatBackOfficePropertyCount(count: number): string {
  if (count <= 0) return "0";
  return count === 1 ? "1 property" : `${count} properties`;
}

/**
 * Founder-only helper: count properties per host_id via service role.
 * Returns empty map when service role is unavailable (UI shows 0, not invented counts).
 */
export async function loadPropertyCountsByHostId(): Promise<PropertyCountByHostId> {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return {};
  const { data, error } = await admin.from("properties").select("id, host_id");
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data) {
    const hostId = typeof row.host_id === "string" ? row.host_id : null;
    if (!hostId) continue;
    counts[hostId] = (counts[hostId] ?? 0) + 1;
  }
  return counts;
}
