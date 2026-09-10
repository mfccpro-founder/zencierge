import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20260908130000_subscription_cancellation_preserve_plan.sql";
const EXPECTED_PREVIOUS_MIGRATION =
  "20260908123000_host_subscription_plan_catalog.sql";
const REPLAY_MIGRATION =
  "20260908120000_subscription_webhook_replay.sql";
const REPLAY_MIGRATION_NORMALIZED_SHA256 =
  "e86b621cf4d843f988ef19c01121d15063673ffcb197f24c1261561cb71f6ba9";
const PLAN_MIGRATION =
  "20260908123000_host_subscription_plan_catalog.sql";
const PLAN_MIGRATION_NORMALIZED_SHA256 =
  "d9ec40fbba8d59c9031d9149dd785dba57297b6cc0573bc291542872e042ecc2";
const RPC_START =
  "-- BEGIN subscription cancellation preserve plan RPC";
const RPC_END =
  "-- END subscription cancellation preserve plan RPC";
const CANCELLATION_START =
  "-- BEGIN cancellation update-only branch";
const CANCELLATION_END =
  "-- END cancellation update-only branch";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizedSha256(value: string) {
  return createHash("sha256")
    .update(normalizeLineEndings(value), "utf8")
    .digest("hex");
}

function extractMarkedSection(
  sql: string,
  startMarker: string,
  endMarker: string,
) {
  const normalized = normalizeLineEndings(sql);
  const start = normalized.indexOf(startMarker);
  const end = normalized.indexOf(endMarker);
  assert(start >= 0, `${startMarker} exists`);
  assert(end > start, `${endMarker} follows its start marker`);
  return normalized
    .slice(start, end + endMarker.length)
    .trim();
}

function functionBody(sql: string) {
  const bodyStart = sql.indexOf("as $$");
  const bodyEnd = sql.indexOf("$$;", bodyStart);
  assert(bodyStart >= 0, "replacement RPC body starts");
  assert(bodyEnd > bodyStart, "replacement RPC body ends");
  return sql.slice(bodyStart, bodyEnd);
}

function runSubscriptionCancellationPreservePlanTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationPath = join(migrationsDir, EXPECTED_MIGRATION);
  const migrationSql = readFileSync(migrationPath, "utf8");
  const schemaSql = readFileSync(
    join(root, "supabase", "schema.sql"),
    "utf8",
  );

  assert(
    migrationNames.includes(EXPECTED_MIGRATION),
    "cancellation preservation migration exists",
  );
  assert(
    migrationNames.filter(
      (name) => name.startsWith("20260908130000_"),
    ).length === 1,
    "cancellation preservation migration timestamp is unique",
  );
  const migrationIndex = migrationNames.indexOf(EXPECTED_MIGRATION);
  assert(
    migrationIndex > 0,
    "cancellation preservation migration has a predecessor",
  );
  assert(
    migrationNames[migrationIndex - 1] ===
      EXPECTED_PREVIOUS_MIGRATION,
    "cancellation preservation migration follows Microblock 6C directly",
  );

  assert(
    normalizedSha256(
      readFileSync(join(migrationsDir, REPLAY_MIGRATION), "utf8"),
    ) === REPLAY_MIGRATION_NORMALIZED_SHA256,
    "protected Microblock 6A migration hash remains unchanged",
  );
  assert(
    normalizedSha256(
      readFileSync(join(migrationsDir, PLAN_MIGRATION), "utf8"),
    ) === PLAN_MIGRATION_NORMALIZED_SHA256,
    "protected Microblock 6C migration hash remains unchanged",
  );

  const migrationRpc = extractMarkedSection(
    migrationSql,
    RPC_START,
    RPC_END,
  );
  const schemaRpc = extractMarkedSection(
    schemaSql,
    RPC_START,
    RPC_END,
  );
  assert(
    migrationRpc === schemaRpc,
    "6D migration RPC and canonical schema RPC are identical after line-ending normalization",
  );

  const expectedSignature = [
    "create or replace function public.process_subscription_webhook_atomic(",
    "  p_provider pg_catalog.text,",
    "  p_event_id pg_catalog.text,",
    "  p_event_type pg_catalog.text,",
    "  p_payload_sha256 pg_catalog.text,",
    "  p_user_id pg_catalog.uuid,",
    "  p_email pg_catalog.text,",
    "  p_plan_id pg_catalog.text,",
    "  p_monthly_usd pg_catalog.numeric,",
    "  p_amount_usd pg_catalog.numeric,",
    "  p_payment_id pg_catalog.text,",
    "  p_square_customer_id pg_catalog.text,",
    "  p_square_subscription_id pg_catalog.text,",
    "  p_occurred_at pg_catalog.timestamptz,",
    "  p_current_period_end pg_catalog.timestamptz",
    ")",
  ].join("\n");
  assert(
    migrationRpc.includes(expectedSignature),
    "replacement preserves every RPC argument name, order, and PostgreSQL type",
  );
  assert(
    /\blanguage plpgsql\b/i.test(migrationRpc),
    "replacement RPC remains PL/pgSQL",
  );
  assert(
    /\bsecurity definer\b/i.test(migrationRpc),
    "replacement RPC remains SECURITY DEFINER",
  );
  assert(
    /set search_path = pg_catalog\b/i.test(migrationRpc),
    "replacement RPC fixes search_path to pg_catalog",
  );

  for (const role of ["public", "anon", "authenticated"]) {
    assert(
      new RegExp(
        `revoke all on function public\\.process_subscription_webhook_atomic\\([\\s\\S]*?\\) from ${role};`,
        "i",
      ).test(migrationRpc),
      `replacement RPC execution remains revoked from ${role}`,
    );
  }
  assert(
    /grant execute on function public\.process_subscription_webhook_atomic\([\s\S]*?\) to service_role;/i.test(
      migrationRpc,
    ),
    "replacement RPC execution remains granted to service_role",
  );
  assert(
    !/grant execute[\s\S]*?\) to (public|anon|authenticated);/i.test(
      migrationRpc,
    ),
    "replacement grants no client RPC execution",
  );

  assert(
    !/\b(create table|alter table|create index|create trigger|create policy)\b/i.test(
      migrationSql,
    ),
    "6D creates no table, column, index, constraint, trigger, or policy",
  );

  const body = functionBody(migrationRpc);
  assert(
    !/\bexecute\b/i.test(body),
    "replacement RPC contains no dynamic SQL",
  );
  assert(
    !/\bexception\s+when\b/i.test(body),
    "replacement RPC does not swallow transaction failures",
  );
  assert(
    !/\b(commit|rollback)\b/i.test(body),
    "replacement RPC leaves transaction control to PostgreSQL",
  );

  const claimAt = body.indexOf(
    "insert into public.subscription_webhook_events",
  );
  const replayAt = body.indexOf(
    "if v_existing_status = 'processed' then",
  );
  const replayReturnAt = body.indexOf("return;", replayAt);
  const cancellationWriteAt = body.indexOf(
    "update public.host_subscriptions as s",
  );
  const paymentWriteAt = body.indexOf(
    "insert into public.subscription_payments",
  );
  const subscriptionWriteAt = body.indexOf(
    "insert into public.host_subscriptions",
  );
  const finalizedAt = body.lastIndexOf("status = 'processed'");
  assert(claimAt >= 0, "replacement RPC atomically claims the event");
  assert(
    replayAt > claimAt &&
      replayReturnAt > replayAt &&
      replayReturnAt < cancellationWriteAt &&
      replayReturnAt < paymentWriteAt,
    "processed replay returns before every downstream write",
  );
  assert(
    cancellationWriteAt > claimAt &&
      paymentWriteAt > claimAt &&
      subscriptionWriteAt > paymentWriteAt,
    "all cancellation and payment writes occur after the replay claim",
  );
  assert(
    finalizedAt > cancellationWriteAt &&
      finalizedAt > paymentWriteAt &&
      finalizedAt > subscriptionWriteAt,
    "ledger finalization follows every downstream write branch",
  );
  assert(
    body.includes("get diagnostics v_processed_count = row_count") &&
      body.includes("webhook event finalization unavailable"),
    "ledger finalization fails closed unless exactly one claim is finalized",
  );
  assert(
    body.includes(
      "v_existing_payload_sha256 is distinct from p_payload_sha256",
    ) &&
      body.includes("webhook event identity conflict"),
    "replacement rejects altered payload reuse",
  );
  assert(
    body.includes("webhook event processing state conflict"),
    "replacement fails closed for impossible replay-ledger states",
  );

  const paymentValidationStart = body.indexOf(
    "if v_event_type = 'payment.succeeded'\n     or v_event_type = 'payment.failed' then",
  );
  const cancellationValidationStart = body.indexOf(
    "if p_plan_id is null then\n      v_plan_id := null;",
    paymentValidationStart,
  );
  const paymentValidation = body.slice(
    paymentValidationStart,
    cancellationValidationStart,
  );
  assert(
    paymentValidation.includes("if p_plan_id is null then") &&
      paymentValidation.includes("v_plan_id = ''") &&
      paymentValidation.includes("if p_monthly_usd is null") &&
      paymentValidation.includes("p_monthly_usd <= 0"),
    "payment success and failure reject null or invalid plan and price",
  );
  assert(
    paymentValidation.includes(
      "p_monthly_usd::pg_catalog.text in ('NaN', 'Infinity', '-Infinity')",
    ),
    "payment price validation rejects non-finite values",
  );
  assert(
    paymentValidation.includes("if p_payment_id is null then") &&
      paymentValidation.includes("v_payment_id = ''") &&
      paymentValidation.includes("if p_amount_usd is null") &&
      paymentValidation.includes("p_amount_usd <= 0"),
    "payment identity and measured amount validation remain unchanged",
  );
  assert(
    body.includes("on conflict (provider_payment_id) do update"),
    "provider payment ID conflict protection remains unchanged",
  );

  const cancellationBranch = extractMarkedSection(
    body,
    CANCELLATION_START,
    CANCELLATION_END,
  );
  assert(
    cancellationBranch.includes(
      "update public.host_subscriptions as s",
    ),
    "cancellation uses an UPDATE-only subscription branch",
  );
  assert(
    !/\binsert\b/i.test(cancellationBranch) &&
      !/subscription_payments/i.test(cancellationBranch),
    "cancellation inserts neither a subscription nor a payment",
  );
  assert(
    cancellationBranch.includes("status = 'canceled'"),
    "existing subscription cancellation sets canceled status",
  );
  assert(
    !/\bplan_id\s*=|\bmonthly_usd\s*=|\bcurrent_period_end\s*=|\blast_payment_at\s*=/i.test(
      cancellationBranch,
    ),
    "cancellation never overwrites plan, price, period, or last payment",
  );
  assert(
    cancellationBranch.includes(
      "returning s.plan_id into resolved_plan_id",
    ),
    "existing cancellation returns the stored plan",
  );
  assert(
    !/\bstarter\b|\b49\b/i.test(cancellationBranch),
    "cancellation never synthesizes Starter or 49-dollar metadata",
  );
  assert(
    cancellationBranch.includes(
      "when v_square_customer_id is null\n              then s.square_customer_id",
    ) &&
      cancellationBranch.includes(
        "when v_square_subscription_id is null\n              then s.square_subscription_id",
      ),
    "missing Square identifiers preserve stored identifiers",
  );
  assert(
    cancellationBranch.includes("else v_square_customer_id") &&
      cancellationBranch.includes("else v_square_subscription_id"),
    "explicit Square identifiers retain existing update behavior",
  );
  assert(
    cancellationBranch.includes("resolved_plan_id := null") &&
      cancellationBranch.includes("skipped_subscription := true") &&
      cancellationBranch.includes(
        "if found then\n        skipped_subscription := false;",
      ),
    "no-row cancellation remains skipped with a null plan",
  );
  assert(
    cancellationBranch.includes("where s.user_id = p_user_id"),
    "cancellation updates only the resolved user's existing row",
  );
  assert(
    !/\bplan_id\s*=|\bmonthly_usd\s*=/i.test(cancellationBranch),
    "existing Pro cancellation preserves Pro and its 99-dollar price",
  );
  assert(
    !/\bplan_id\s*=|\bmonthly_usd\s*=/i.test(cancellationBranch),
    "existing Portfolio cancellation preserves Portfolio and its 149-dollar price",
  );

  assert(
    body.includes(
      "if v_event_type = 'subscription.canceled' then\n        resolved_plan_id := null;",
    ) &&
      body.includes(
        "select s.plan_id\n          into resolved_plan_id",
      ),
    "cancellation replay reports the current stored plan or null when absent",
  );
  assert(
    body.includes("processed := false") &&
      body.includes("replayed := true"),
    "replay remains processed false and replayed true",
  );

  assert(
    schemaSql.includes(
      "create table if not exists public.subscription_webhook_events",
    ) &&
      /primary key\s*\(\s*provider\s*,\s*event_id\s*\)/i.test(
        schemaSql,
      ),
    "canonical schema retains the durable composite-key replay ledger",
  );
  assert(
    schemaSql.includes(
      "alter table public.subscription_webhook_events enable row level security",
    ) &&
      schemaSql.includes(
        "revoke all on table public.subscription_webhook_events from public",
      ) &&
      schemaSql.includes(
        "revoke all on table public.subscription_webhook_events from anon",
      ) &&
      schemaSql.includes(
        "revoke all on table public.subscription_webhook_events from authenticated",
      ) &&
      schemaSql.includes(
        "grant select on table public.subscription_webhook_events to service_role",
      ),
    "canonical replay ledger remains RLS-protected and service-role-only",
  );
  assert(
    !/raw_body|signature|secret|access_token|card_number/i.test(
      migrationRpc,
    ),
    "replacement RPC stores no raw payload, signature, secret, token, or card data",
  );

  console.log(
    "subscription cancellation preservation SQL contract tests passed",
  );
}

runSubscriptionCancellationPreservePlanTests();