export const FOUNDER_BILLING_READ_PAGE_SIZE = 1000;
export const FOUNDER_BILLING_READ_MAX_ROWS = 50_000;

export const FOUNDER_HOST_SUBSCRIPTIONS_RPC = "founder_backoffice_host_subscriptions_page";
export const FOUNDER_SUBSCRIPTION_PAYMENTS_RPC = "founder_backoffice_subscription_payments_page";

export type FounderBillingRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, string | number | boolean | null>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type FounderBillingRead = {
  rows: Record<string, unknown>[];
  error: string | null;
};

function clampPageSize(value: number | undefined): number {
  const size = Math.trunc(value ?? FOUNDER_BILLING_READ_PAGE_SIZE);
  if (!Number.isFinite(size)) return FOUNDER_BILLING_READ_PAGE_SIZE;
  return Math.min(1000, Math.max(1, size));
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

function readError(table: "host_subscriptions" | "subscription_payments", message: string): string {
  return message.includes(table) ? message : `Could not read ${table}. ${message}`;
}

/**
 * Keyset pages of host_subscriptions for founder MRR.
 * Any failed page discards earlier rows so a partial list is not a full catalog.
 */
export async function readFounderHostSubscriptionPages(
  admin: FounderBillingRpcClient,
  input?: { pageSize?: number; maxRows?: number; onCap?: "unavailable" | "window" },
): Promise<FounderBillingRead> {
  const pageSize = clampPageSize(input?.pageSize);
  const maxRows = Math.max(pageSize, Math.trunc(input?.maxRows ?? FOUNDER_BILLING_READ_MAX_ROWS));
  const rows: Record<string, unknown>[] = [];
  let cursor: { created_at: string; user_id: string } | null = null;

  while (rows.length < maxRows) {
    const { data, error } = await admin.rpc(FOUNDER_HOST_SUBSCRIPTIONS_RPC, {
      p_after_created_at: cursor?.created_at ?? null,
      p_after_user_id: cursor?.user_id ?? null,
      p_limit: pageSize,
    });
    if (error) return { rows: [], error: readError("host_subscriptions", error.message) };
    const batch = asRows(data);
    if (batch.length === 0) return { rows, error: null };
    const last = batch[batch.length - 1];
    const created_at = typeof last?.created_at === "string" ? last.created_at : "";
    const user_id = typeof last?.user_id === "string" ? last.user_id : "";
    if (!created_at || !user_id) {
      return { rows: [], error: "Could not read host_subscriptions." };
    }
    if (cursor && created_at === cursor.created_at && user_id === cursor.user_id) {
      return { rows: [], error: "Could not read host_subscriptions." };
    }
    rows.push(...batch);
    if (batch.length < pageSize) return { rows: rows.slice(0, maxRows), error: null };
    if (rows.length >= maxRows) {
      return input?.onCap === "window"
        ? { rows: rows.slice(0, maxRows), error: null }
        : { rows: [], error: "Could not read host_subscriptions. Read stopped at the safety cap." };
    }
    cursor = { created_at, user_id };
  }

  return { rows: [], error: "Could not read host_subscriptions. Read stopped at the safety cap." };
}

/**
 * Keyset pages of subscription_payments for founder collected income.
 * Any failed page discards earlier rows so a partial sum is not a full month.
 */
export async function readFounderSubscriptionPaymentPages(
  admin: FounderBillingRpcClient,
  input: {
    fromIso: string | null;
    toIso: string | null;
    pageSize?: number;
    maxRows?: number;
    onCap?: "unavailable" | "window";
    newestFirst?: boolean;
  },
): Promise<FounderBillingRead> {
  const pageSize = clampPageSize(input.pageSize);
  const maxRows = Math.max(pageSize, Math.trunc(input.maxRows ?? FOUNDER_BILLING_READ_MAX_ROWS));
  const rows: Record<string, unknown>[] = [];
  let cursor: { created_at: string; id: string } | null = null;

  while (rows.length < maxRows) {
    const { data, error } = await admin.rpc(FOUNDER_SUBSCRIPTION_PAYMENTS_RPC, {
      p_from: input.fromIso,
      p_to: input.toIso,
      p_after_created_at: cursor?.created_at ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: pageSize,
      p_newest_first: input.newestFirst === true,
    });
    if (error) return { rows: [], error: readError("subscription_payments", error.message) };
    const batch = asRows(data);
    if (batch.length === 0) return { rows, error: null };
    const last = batch[batch.length - 1];
    const created_at = typeof last?.created_at === "string" ? last.created_at : "";
    const id = typeof last?.id === "string" ? last.id : "";
    if (!created_at || !id) {
      return { rows: [], error: "Could not read subscription_payments." };
    }
    if (cursor && created_at === cursor.created_at && id === cursor.id) {
      return { rows: [], error: "Could not read subscription_payments." };
    }
    rows.push(...batch);
    if (batch.length < pageSize) return { rows: rows.slice(0, maxRows), error: null };
    if (rows.length >= maxRows) {
      return input.onCap === "window"
        ? { rows: rows.slice(0, maxRows), error: null }
        : { rows: [], error: "Could not read subscription_payments. Read stopped at the safety cap." };
    }
    cursor = { created_at, id };
  }

  return { rows: [], error: "Could not read subscription_payments. Read stopped at the safety cap." };
}
