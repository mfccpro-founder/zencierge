import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20260910120000_square_billing_correlation_schema.sql";
const EXPECTED_PREVIOUS_MIGRATION =
  "20260908130000_subscription_cancellation_preserve_plan.sql";
const REPLAY_MIGRATION =
  "20260908120000_subscription_webhook_replay.sql";
const REPLAY_SHA256 =
  "e86b621cf4d843f988ef19c01121d15063673ffcb197f24c1261561cb71f6ba9";
const PLAN_MIGRATION =
  "20260908123000_host_subscription_plan_catalog.sql";
const PLAN_SHA256 =
  "d9ec40fbba8d59c9031d9149dd785dba57297b6cc0573bc291542872e042ecc2";
const CANCELLATION_MIGRATION =
  "20260908130000_subscription_cancellation_preserve_plan.sql";
const CANCELLATION_SHA256 =
  "4f3fa41f2ddf6a36e1b54b54cd185844e62faaf5d0c03fab89b67c28103b7f20";
const CONTRACT_START = "-- BEGIN square billing correlation schema";
const CONTRACT_END = "-- END square billing correlation schema";
const RPC_START = "-- BEGIN subscription cancellation preserve plan RPC";
const RPC_END = "-- END subscription cancellation preserve plan RPC";
const CANCELLATION_START = "-- BEGIN cancellation update-only branch";
const CANCELLATION_END = "-- END cancellation update-only branch";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizedSha256(path: string) {
  return createHash("sha256")
    .update(normalizeLineEndings(readFileSync(path, "utf8")), "utf8")
    .digest("hex");
}

function extractMarkedSection(
  value: string,
  startMarker: string,
  endMarker: string,
) {
  const normalized = normalizeLineEndings(value);
  const start = normalized.indexOf(startMarker);
  const end = normalized.indexOf(endMarker);
  assert(start >= 0, `${startMarker} exists`);
  assert(end > start, `${endMarker} follows its start marker`);
  return normalized.slice(start, end + endMarker.length).trim();
}

function createTable(contract: string, tableName: string) {
  const marker = `create table public.${tableName} (`;
  const start = contract.indexOf(marker);
  const end = contract.indexOf("\n);", start);
  assert(start >= 0, `${tableName} definition starts`);
  assert(end > start, `${tableName} definition ends`);
  return contract.slice(start, end + 3);
}

function alterTable(contract: string, tableName: string) {
  const marker = `alter table public.${tableName}\n`;
  const start = contract.indexOf(marker);
  const end = contract.indexOf(";\n", start);
  assert(start >= 0, `${tableName} alteration starts`);
  assert(end > start, `${tableName} alteration ends`);
  return contract.slice(start, end + 1);
}

function runSquareBillingCorrelationSchemaTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationSql = normalizeLineEndings(
    readFileSync(join(migrationsDir, EXPECTED_MIGRATION), "utf8"),
  );
  const schemaSql = normalizeLineEndings(
    readFileSync(join(root, "supabase", "schema.sql"), "utf8"),
  );

  assert(
    migrationNames.includes(EXPECTED_MIGRATION),
    "7D1 migration exists",
  );
  assert(
    migrationNames.filter((name) =>
      name.startsWith("20260910120000_"),
    ).length === 1,
    "7D1 migration timestamp is unique",
  );
  const migrationIndex = migrationNames.indexOf(EXPECTED_MIGRATION);
  assert(
    migrationIndex > 0 &&
      migrationNames[migrationIndex - 1] === EXPECTED_PREVIOUS_MIGRATION,
    "7D1 follows Microblock 6D directly",
  );
  assert(
    migrationNames[migrationNames.length - 1] === EXPECTED_MIGRATION,
    "7D1 is the latest migration",
  );

  assert(
    normalizedSha256(join(migrationsDir, REPLAY_MIGRATION)) ===
      REPLAY_SHA256,
    "protected Microblock 6A migration remains unchanged",
  );
  assert(
    normalizedSha256(join(migrationsDir, PLAN_MIGRATION)) === PLAN_SHA256,
    "protected Microblock 6C migration remains unchanged",
  );
  assert(
    normalizedSha256(join(migrationsDir, CANCELLATION_MIGRATION)) ===
      CANCELLATION_SHA256,
    "protected Microblock 6D migration remains unchanged",
  );

  assert(
    /^begin;\n/.test(migrationSql) || /\nbegin;\n/.test(migrationSql),
    "7D1 starts an explicit transaction",
  );
  assert(/\ncommit;\s*$/.test(migrationSql), "7D1 commits explicitly");
  assert(
    migrationSql.includes("do $square_billing_correlation_preflight$") &&
      migrationSql.indexOf("do $square_billing_correlation_preflight$") <
        migrationSql.indexOf(CONTRACT_START),
    "preflight executes before correlation DDL",
  );

  const migrationContract = extractMarkedSection(
    migrationSql,
    CONTRACT_START,
    CONTRACT_END,
  );
  const schemaContract = extractMarkedSection(
    schemaSql,
    CONTRACT_START,
    CONTRACT_END,
  );
  assert(
    migrationContract === schemaContract,
    "migration and canonical schema correlation contracts are identical",
  );

  const hostAlter = alterTable(
    migrationContract,
    "host_subscriptions",
  );
  const paymentAlter = alterTable(
    migrationContract,
    "subscription_payments",
  );
  for (const definition of [
    "billing_cycle pg_catalog.text",
    "billing_amount_usd pg_catalog.numeric(10, 2)",
    "square_environment pg_catalog.text",
    "square_location_id pg_catalog.text",
    "square_plan_variation_id pg_catalog.text",
    "square_subscription_status pg_catalog.text",
    "square_subscription_version pg_catalog.int8",
    "square_start_date pg_catalog.date",
    "square_charged_through_date pg_catalog.date",
    "square_canceled_date pg_catalog.date",
  ]) {
    assert(
      hostAlter.includes(`add column ${definition}`),
      `host_subscriptions adds nullable ${definition}`,
    );
  }
  assert(
    !/\badd column\b[^\n]*\bnot null\b/i.test(hostAlter),
    "all new host subscription columns are nullable",
  );
  for (const definition of [
    "billing_cycle pg_catalog.text",
    "square_environment pg_catalog.text",
    "square_location_id pg_catalog.text",
    "square_subscription_id pg_catalog.text",
    "square_invoice_id pg_catalog.text",
    "square_order_id pg_catalog.text",
  ]) {
    assert(
      paymentAlter.includes(`add column ${definition}`),
      `subscription_payments adds nullable ${definition}`,
    );
  }
  assert(
    !/\badd column\b[^\n]*\bnot null\b/i.test(paymentAlter),
    "all new subscription payment columns are nullable",
  );

  const canonicalPayments = schemaSql.slice(
    schemaSql.indexOf(
      "create table if not exists public.subscription_payments (",
    ),
    schemaSql.indexOf("\n);", schemaSql.indexOf(
      "create table if not exists public.subscription_payments (",
    )) + 3,
  );
  assert(
    canonicalPayments.includes("subscription_id uuid"),
    "legacy subscription_id remains uuid",
  );
  assert(
    paymentAlter.includes(
      "add column square_subscription_id pg_catalog.text",
    ),
    "Square subscription ID uses a new text column",
  );
  assert(
    !migrationSql.includes("alter column subscription_id"),
    "7D1 never alters legacy subscription_id",
  );

  const paymentMethods = createTable(
    migrationContract,
    "square_payment_methods",
  );
  const intents = createTable(
    migrationContract,
    "square_subscription_intents",
  );
  const invoices = createTable(
    migrationContract,
    "square_subscription_invoices",
  );

  for (const [label, table] of [
    ["payment methods", paymentMethods],
    ["subscription intents", intents],
    ["subscription invoices", invoices],
  ] as const) {
    assert(
      table.includes(
        "references auth.users (id) on delete cascade",
      ),
      `${label} belongs to an auth user`,
    );
    const references = [...table.matchAll(/\breferences\s+([a-z0-9_.]+)/gi)]
      .map((match) => match[1].toLowerCase());
    assert(
      references.length === 1 &&
        references[0] === "auth.users",
      `${label} has no external-ID foreign keys`,
    );
  }

  assert(
    paymentMethods.includes("square_card_id pg_catalog.text not null") &&
      intents.includes("square_card_id pg_catalog.text"),
    "card IDs exist only in server-only correlation tables",
  );
  assert(
    !hostAlter.includes("square_card_id") &&
      !paymentAlter.includes("square_card_id"),
    "card ID is absent from host_subscriptions and subscription_payments",
  );

  for (const constraint of [
    "host_subscriptions_billing_cycle_check",
    "host_subscriptions_billing_amount_usd_check",
    "host_subscriptions_square_environment_check",
    "host_subscriptions_square_location_id_check",
    "host_subscriptions_square_plan_variation_id_check",
    "host_subscriptions_square_subscription_status_check",
    "host_subscriptions_square_subscription_version_check",
    "square_payment_methods_environment_check",
    "square_payment_methods_card_id_check",
    "square_subscription_intents_plan_id_check",
    "square_subscription_intents_billing_cycle_check",
    "square_subscription_intents_amount_check",
    "square_subscription_intents_status_check",
    "square_subscription_invoices_environment_check",
    "square_subscription_invoices_plan_id_check",
    "square_subscription_invoices_billing_cycle_check",
    "square_subscription_invoices_status_check",
    "subscription_payments_billing_cycle_check",
    "subscription_payments_square_environment_check",
  ]) {
    assert(
      migrationContract.includes(`constraint ${constraint}`),
      `${constraint} exists`,
    );
  }

  for (const indexName of [
    "host_subscriptions_square_customer_environment_key",
    "host_subscriptions_square_subscription_environment_key",
    "square_payment_methods_environment_card_key",
    "square_payment_methods_user_environment_idx",
    "square_subscription_intents_one_open_per_user_idx",
    "square_subscription_intents_subscription_id_idx",
    "square_subscription_intents_expiration_idx",
    "square_subscription_invoices_order_id_idx",
    "square_subscription_invoices_subscription_id_idx",
    "square_subscription_invoices_user_idx",
    "subscription_payments_square_subscription_idx",
    "subscription_payments_square_invoice_idx",
    "subscription_payments_square_order_idx",
  ]) {
    assert(
      migrationContract.includes(indexName),
      `${indexName} exists`,
    );
  }

  for (const tableName of [
    "square_payment_methods",
    "square_subscription_intents",
    "square_subscription_invoices",
  ]) {
    assert(
      migrationContract.includes(
        `alter table public.${tableName} enable row level security`,
      ),
      `${tableName} enables RLS`,
    );
    for (const role of [
      "public",
      "anon",
      "authenticated",
      "service_role",
    ]) {
      assert(
        migrationContract.includes(
          `revoke all on table public.${tableName} from ${role}`,
        ),
        `${tableName} revokes ${role}`,
      );
    }
    assert(
      new RegExp(
        `grant select, insert, update\\s+on table public\\.${tableName}` +
          "\\s+to service_role",
        "i",
      ).test(migrationContract),
      `${tableName} grants only planned service-role operations`,
    );
  }
  assert(
    !/\bcreate\s+policy\b/i.test(migrationContract),
    "new server-only tables have no client policies",
  );
  assert(
    !/\bgrant\s+delete\b|\bgrant\s+all\b/i.test(migrationContract),
    "service role receives no delete or all privilege",
  );

  const contractWithoutComments = migrationContract
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert(
    !/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|copy)\b/i
      .test(contractWithoutComments),
    "7D1 performs no row writes",
  );
  assert(
    !/\bcreate\s+(constraint\s+)?trigger\b|\bexecute\s+(function|procedure)\b/i
      .test(contractWithoutComments),
    "7D1 creates no triggers",
  );
  assert(
    !/\bcreate\s+or\s+replace\s+function\b/i.test(migrationSql),
    "7D1 does not replace the webhook RPC",
  );
  assert(
    !/\balter\s+table\s+public\.subscription_webhook_events\b/i
      .test(migrationSql),
    "7D1 does not modify the webhook ledger",
  );
  assert(
    !/\b(subscription\.created|subscription\.updated)\b/i.test(migrationSql),
    "7D1 does not expand webhook event types",
  );
  assert(
    !/\bproperties\b|\bhost_id\b/i.test(migrationSql),
    "7D1 does not mix property ownership changes",
  );
  assert(
    !/\b(source_token|verification_token|access_token|card_number|pan|cvv|signature|raw_body|raw_payload)\b/i
      .test(migrationContract),
    "correlation schema stores no sensitive payment or webhook material",
  );

  const migration6d = normalizeLineEndings(
    readFileSync(join(migrationsDir, CANCELLATION_MIGRATION), "utf8"),
  );
  const migrationRpc = extractMarkedSection(
    migration6d,
    RPC_START,
    RPC_END,
  );
  const schemaRpc = extractMarkedSection(schemaSql, RPC_START, RPC_END);
  assert(
    migrationRpc === schemaRpc,
    "canonical schema retains the exact Microblock 6D RPC",
  );
  const cancellationBranch = extractMarkedSection(
    migrationRpc,
    CANCELLATION_START,
    CANCELLATION_END,
  );
  assert(
    cancellationBranch.includes(
      "update public.host_subscriptions as s",
    ) &&
      cancellationBranch.includes("where s.user_id = p_user_id") &&
      cancellationBranch.includes(
        "returning s.plan_id into resolved_plan_id",
      ),
    "6D cancellation remains update-only and returns stored plan",
  );
  assert(
    !/\bplan_id\s*=|\bmonthly_usd\s*=/i.test(cancellationBranch),
    "6D cancellation preserves plan and price",
  );
  assert(
    cancellationBranch.includes(
      "when v_square_customer_id is null\n" +
        "              then s.square_customer_id",
    ) &&
      cancellationBranch.includes(
        "when v_square_subscription_id is null\n" +
          "              then s.square_subscription_id",
      ),
    "6D cancellation preserves absent Square identifiers",
  );

  console.log("Square billing correlation schema tests passed");
}

runSquareBillingCorrelationSchemaTests();