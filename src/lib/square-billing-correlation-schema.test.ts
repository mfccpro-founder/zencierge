import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20260910120000_square_billing_correlation_schema.sql";
const EXPECTED_NEXT_MIGRATION =
  "20260910130000_subscription_billing_acl_normalization.sql";
const EXPECTED_HOST_CORRELATION_RPC_MIGRATION =
  "20260915140000_square_billing_host_correlation_rpcs.sql";
const EXPECTED_RPC_OWNER_STATUS_MIGRATION =
  "20260915180000_square_billing_host_correlation_rpc_owner_status.sql";
const EXPECTED_UPSERT_AMBIGUITY_MIGRATION =
  "20260916143000_square_billing_upsert_host_correlation_user_id_ambiguity.sql";
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
const ACL_START = "-- BEGIN subscription billing ACL normalization";
const ACL_END = "-- END subscription billing ACL normalization";
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
  const aclMigrationSql = normalizeLineEndings(
    readFileSync(join(migrationsDir, EXPECTED_NEXT_MIGRATION), "utf8"),
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
    migrationNames[migrationIndex + 1] === EXPECTED_NEXT_MIGRATION,
    "baseline ACL normalization follows 7D1 directly",
  );
  assert(
    migrationNames.includes(EXPECTED_HOST_CORRELATION_RPC_MIGRATION),
    "host correlation RPC migration exists",
  );
  assert(
    migrationNames.includes(EXPECTED_RPC_OWNER_STATUS_MIGRATION),
    "RPC owner/status migration exists",
  );
  assert(
    migrationNames.includes(EXPECTED_UPSERT_AMBIGUITY_MIGRATION),
    "upsert user_id ambiguity migration exists",
  );
  assert(
    migrationNames.includes("20260928153000_ai_usage_tts_meter_foundation.sql"),
    "tts meter foundation migration exists",
  );
  assert(
    migrationNames.indexOf("20260927160000_founder_backoffice_subscription_payments_text_casts.sql") <
      migrationNames.indexOf("20260928153000_ai_usage_tts_meter_foundation.sql"),
    "tts meter foundation follows the payment text-cast migration",
  );
  assert(
    migrationNames.indexOf(EXPECTED_UPSERT_AMBIGUITY_MIGRATION) <
      migrationNames.indexOf("20260926140000_founder_backoffice_billing_read.sql"),
    "founder billing read follows the user_id ambiguity migration",
  );
  assert(
    migrationNames.indexOf(EXPECTED_RPC_OWNER_STATUS_MIGRATION) >
      migrationNames.indexOf(EXPECTED_HOST_CORRELATION_RPC_MIGRATION),
    "owner/status migration follows host correlation RPCs",
  );
  assert(
    migrationNames.indexOf(EXPECTED_UPSERT_AMBIGUITY_MIGRATION) >
      migrationNames.indexOf(EXPECTED_RPC_OWNER_STATUS_MIGRATION),
    "user_id ambiguity migration follows owner/status",
  );
  assert(
    migrationNames.indexOf(EXPECTED_HOST_CORRELATION_RPC_MIGRATION) >
      migrationNames.indexOf(EXPECTED_NEXT_MIGRATION),
    "host correlation RPCs follow baseline ACL normalization",
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

  const aclMigrationContract = extractMarkedSection(
    aclMigrationSql,
    ACL_START,
    ACL_END,
  );
  const schemaAclContract = extractMarkedSection(
    schemaSql,
    ACL_START,
    ACL_END,
  );
  assert(
    aclMigrationContract === schemaAclContract,
    "migration and canonical schema ACL contracts are identical",
  );

  const aclStatements = aclMigrationSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const expectedAclStatements = [
    "begin",
    "revoke all on table public.host_subscriptions from public",
    "revoke all on table public.host_subscriptions from anon",
    "revoke all on table public.host_subscriptions from authenticated",
    "revoke all on table public.host_subscriptions from service_role",
    "grant select on table public.host_subscriptions to authenticated",
    "grant truncate, references, trigger on table public.host_subscriptions to service_role",
    "revoke all on table public.subscription_payments from public",
    "revoke all on table public.subscription_payments from anon",
    "revoke all on table public.subscription_payments from authenticated",
    "revoke all on table public.subscription_payments from service_role",
    "grant select on table public.subscription_payments to authenticated",
    "grant truncate, references, trigger on table public.subscription_payments to service_role",
    "commit",
  ];
  assert(
    JSON.stringify(aclStatements) === JSON.stringify(expectedAclStatements),
    "ACL migration contains only the exact authorized transaction and ACL statements",
  );
  assert(
    aclStatements.filter((statement) => statement.startsWith("revoke all "))
      .length === 8,
    "ACL migration has exactly eight REVOKE ALL statements",
  );
  assert(
    aclStatements.filter(
      (statement) =>
        statement.startsWith("grant select ") &&
        statement.endsWith(" to authenticated"),
    ).length === 2,
    "ACL migration has exactly two authenticated SELECT grants",
  );
  assert(
    aclStatements.filter(
      (statement) =>
        statement.startsWith("grant truncate, references, trigger ") &&
        statement.endsWith(" to service_role"),
    ).length === 2,
    "ACL migration has exactly two service-role maintenance grants",
  );
  assert(
    !/\bmaintain\b/i.test(aclMigrationSql),
    "ACL migration contains no literal MAINTAIN privilege",
  );
  assert(
    !/\b(insert|update|delete|truncate)\s+(into|public\.|from|table)\b/i.test(
      aclMigrationSql,
    ) &&
      !/\b(create|alter|drop|comment|copy|merge|call|execute)\b/i.test(
        aclMigrationSql
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n"),
      ),
    "ACL migration contains no row DML, structural DDL, or dynamic SQL",
  );
  assert(
    !/\bpolicy\b|\brow\s+level\s+security\b|\bowner\s+to\b|\bfunction\b/i.test(
      aclMigrationSql
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n"),
    ),
    "ACL migration does not change policies, RLS, ownership, or functions",
  );
  const schemaAfterAclContract = schemaSql.slice(
    schemaSql.indexOf(ACL_END) + ACL_END.length,
  );
  assert(
    !/\b(grant|revoke)\b[^;]*\b(?:table\s+)?public\.(host_subscriptions|subscription_payments)\b/i.test(
      schemaAfterAclContract,
    ),
    "later canonical schema statements do not override baseline billing ACLs",
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