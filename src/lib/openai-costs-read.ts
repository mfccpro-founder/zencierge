import {
  collectOpenAiOrganizationCosts,
  openAiCostsUtcWindowForNewYorkMonth,
  reconciliationFromWindow,
  resolveOpenAiCostsScope,
  type OpenAiCostsFetch,
  type OpenAiCostsReconciliation,
} from "@/lib/openai-costs";

/** Server-only Back Office reader. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("openai-costs-read is server-only");
}

export async function readOpenAiBackOfficeCosts(
  input: {
    now?: Date;
    env?: Record<string, string | undefined>;
    fetchImpl?: OpenAiCostsFetch;
    authorize?: () => Promise<boolean> | boolean;
  } = {},
): Promise<OpenAiCostsReconciliation> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const window = openAiCostsUtcWindowForNewYorkMonth(now);
  const scope = resolveOpenAiCostsScope({
    projectId: env.OPENAI_COSTS_PROJECT_ID,
    apiKeyId: env.OPENAI_COSTS_API_KEY_ID,
  });
  const allowed = input.authorize ? await input.authorize() : await authorizeBackOfficeReader();
  if (!allowed) {
    return reconciliationFromWindow({
      window,
      scope,
      status: "unavailable",
      unavailableReason: "unauthorized",
      amountValue: null,
      currency: null,
    });
  }

  const adminKey = readAdminKey(env);
  if (!adminKey) {
    return reconciliationFromWindow({
      window,
      scope,
      status: "not_configured",
      unavailableReason: null,
      amountValue: null,
      currency: null,
    });
  }

  const collected = await collectOpenAiOrganizationCosts({
    fetchImpl: input.fetchImpl ?? fetch,
    adminKey,
    startTimeUnix: unixSeconds(window.utcWindowStart),
    endTimeUnix: unixSeconds(window.utcWindowEnd),
    projectId: scope.projectId,
    apiKeyId: scope.apiKeyId,
  });
  if (!collected.ok) {
    return reconciliationFromWindow({
      window,
      scope,
      status: "unavailable",
      unavailableReason: collected.reason,
      amountValue: null,
      currency: null,
    });
  }
  return reconciliationFromWindow({
    window,
    scope,
    status: "ready",
    unavailableReason: null,
    amountValue: collected.amountValue,
    currency: collected.currency,
  });
}

async function authorizeBackOfficeReader(): Promise<boolean> {
  const [{ requireHostUser }, { isSuperAdmin }] = await Promise.all([
    import("@/lib/supabase-route"),
    import("@/lib/admin-auth"),
  ]);
  const auth = await requireHostUser();
  return isSuperAdmin(auth.user);
}

function readAdminKey(env: Record<string, string | undefined>): string | null {
  const key =
    env.OPENAI_ADMIN_KEY?.trim() ||
    env.OPENAI_ADMIN_API_KEY?.trim() ||
    env.OPENAI_ORGANIZATION_ADMIN_KEY?.trim() ||
    "";
  return key || null;
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
