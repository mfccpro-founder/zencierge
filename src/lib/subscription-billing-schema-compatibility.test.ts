import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20260908110000_subscription_billing_schema_compatibility.sql";
const EXPECTED_PREVIOUS_MIGRATION =
  "20260907001500_system_health_alert_state.sql";
const EXPECTED_NEXT_MIGRATION =
  "20260908120000_subscription_webhook_replay.sql";
const REPLAY_MIGRATION =
  "20260908120000_subscription_webhook_replay.sql";
const REPLAY_SHA256 =
  "3cabf8c583dd7d7f694e65a1e756ecc432a59f0ae2892a0d3a16e32fe558cf7d";
const PLAN_MIGRATION =
  "20260908123000_host_subscription_plan_catalog.sql";
const PLAN_SHA256 =
  "d9ec40fbba8d59c9031d9149dd785dba57297b6cc0573bc291542872e042ecc2";
const CANCELLATION_MIGRATION =
  "20260908130000_subscription_cancellation_preserve_plan.sql";
const CANCELLATION_SHA256 =
  "7f2510bb55b463e7fbd4dc5f03fe468207b340f25fffad833c083808d1dee286";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizedSha256(path: string) {
  return createHash("sha256")
    .update(normalizeLineEndings(readFileSync(path, "utf8")), "utf8")
    .digest("hex");
}

function extractCreateTable(sql: string, tableName: string) {
  const startMarker =
    `create table if not exists public.${tableName} (`;
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf("\n);", start);
  assert(start >= 0, `${tableName} canonical definition starts`);
  assert(end > start, `${tableName} canonical definition ends`);
  return sql.slice(start, end + 3);
}

function runSubscriptionBillingSchemaCompatibilityTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationSql = normalizeLineEndings(
    readFileSync(join(migrationsDir, EXPECTED_MIGRATION), "utf8"),
  );
  const compactMigrationSql = migrationSql
    .replace(/\s+/g, " ")
    .trim();
  const schemaSql = normalizeLineEndings(
    readFileSync(join(root, "supabase", "schema.sql"), "utf8"),
  );
  const canonicalPayments = extractCreateTable(
    schemaSql,
    "subscription_payments",
  );

  assert(
    migrationNames.includes(EXPECTED_MIGRATION),
    "billing compatibility migration exists",
  );
  assert(
    migrationNames.filter(
      (name) => name.startsWith("20260908110000_"),
    ).length === 1,
    "billing compatibility migration timestamp is unique",
  );

  const migrationIndex = migrationNames.indexOf(EXPECTED_MIGRATION);
  assert(
    migrationIndex > 0,
    "billing compatibility migration has a predecessor",
  );
  assert(
    migrationNames[migrationIndex - 1] ===
      EXPECTED_PREVIOUS_MIGRATION,
    "billing compatibility follows the expected historical predecessor",
  );
  assert(
    migrationNames[migrationIndex + 1] === EXPECTED_NEXT_MIGRATION,
    "billing compatibility immediately precedes Microblock 6A",
  );

  assert(
    normalizedSha256(join(migrationsDir, REPLAY_MIGRATION)) ===
      REPLAY_SHA256,
    "protected Microblock 6A migration remains unchanged",
  );
  assert(
    normalizedSha256(join(migrationsDir, PLAN_MIGRATION)) ===
      PLAN_SHA256,
    "protected Microblock 6C migration remains unchanged",
  );
  assert(
    normalizedSha256(
      join(migrationsDir, CANCELLATION_MIGRATION),
    ) === CANCELLATION_SHA256,
    "protected Microblock 6D migration remains unchanged",
  );

  assert(
    /^do \$subscription_billing_compatibility\$/m.test(migrationSql) &&
      /\$subscription_billing_compatibility\$;\s*$/.test(migrationSql),
    "compatibility work is contained in one atomic PostgreSQL statement",
  );
  assert(
    migrationSql.includes(
      "lock table public.host_subscriptions, public.subscription_payments",
    ),
    "compatibility migration locks both target tables before validation",
  );
  assert(
    migrationSql.includes(
      "if exists (select 1 from public.host_subscriptions)",
    ) &&
      migrationSql.includes(
        "if exists (select 1 from public.subscription_payments)",
      ),
    "compatibility migration fails closed unless both tables are empty",
  );

  assert(
    !/\b(insert\s+into|update\s+public\.|delete\s+from|merge\s+into|truncate|copy\s+)/i.test(
      migrationSql,
    ),
    "compatibility migration performs no row writes or copy",
  );
  assert(
    !/\bexecute\b/i.test(migrationSql),
    "compatibility migration contains no dynamic SQL",
  );
  assert(
    !/\bbackfill\b/i.test(migrationSql),
    "compatibility migration performs no backfill",
  );
  assert(
    !/subscription_webhook_events|process_subscription_webhook_atomic/i.test(
      migrationSql,
    ),
    "compatibility migration creates no replay ledger or RPC",
  );
  assert(
    !/\b(create|drop)\s+trigger\b/i.test(migrationSql),
    "compatibility migration creates no trigger",
  );
  assert(
    !/\bgrant\s|\brevoke\s/i.test(migrationSql),
    "compatibility migration preserves grants and revocations",
  );

  for (const column of [
    "id",
    "subscription_id",
    "gateway_payment_id",
    "amount_paid",
    "net_revenue",
    "gateway_fee",
    "payment_status",
    "paid_at",
    "user_id",
  ]) {
    assert(
      !new RegExp(
        `(?:drop|rename)\\s+(?:column\\s+)?${column}\\b`,
        "i",
      ).test(migrationSql),
      `legacy payment column ${column} is never dropped or renamed`,
    );
  }

  for (const column of [
    "gateway_payment_id",
    "amount_paid",
    "net_revenue",
    "gateway_fee",
    "payment_status",
  ]) {
    assert(
      new RegExp(
        `alter\\s+column\\s+${column}\\s+drop\\s+not\\s+null`,
        "i",
      ).test(migrationSql),
      `${column} becomes nullable for newer-family writes`,
    );
  }

  assert(
    migrationSql.includes(
      "add column is_lifetime_free pg_catalog.bool not null default false",
    ) &&
      migrationSql.includes(
        "add column updated_at pg_catalog.timestamptz not null default pg_catalog.now()",
      ),
    "missing canonical host columns are added",
  );
  assert(
    migrationSql.includes(
      "add constraint host_subscriptions_plan_id_check",
    ) &&
      migrationSql.includes(
        "check (plan_id in ('starter', 'pro', 'agency'))",
      ),
    "exact historical pre-6C plan constraint is established",
  );
  assert(
    migrationSql.includes(
      "add constraint host_subscriptions_status_check",
    ),
    "canonical host status constraint is established",
  );
  assert(
    !/alter\s+column\s+monthly_usd\s+set\s+default/i.test(
      migrationSql,
    ),
    "compatibility migration leaves the 29-dollar default for 6C",
  );

  for (const definition of [
    "add column host_email pg_catalog.text",
    "add column amount_usd pg_catalog.numeric(10, 2)",
    "add column currency pg_catalog.text not null default 'USD'",
    "add column plan_id pg_catalog.text",
    "add column status pg_catalog.text",
    "add column provider_event pg_catalog.text",
    "add column provider_payment_id pg_catalog.text",
    "add column created_at pg_catalog.timestamptz not null default pg_catalog.now()",
  ]) {
    assert(
      migrationSql.includes(definition),
      `new payment definition exists: ${definition}`,
    );
  }

  for (const constraintName of [
    "host_subscriptions_pkey",
    "host_subscriptions_user_id_fkey",
    "host_subscriptions_complimentary_granted_by_fkey",
    "subscription_payments_pkey",
    "subscription_payments_user_id_fkey",
    "subscription_payments_gateway_payment_id_key",
  ]) {
    assert(
      compactMigrationSql.includes(
        `constraints.conname = '${constraintName}'`,
      ),
      `precondition validates ${constraintName}`,
    );
  }
  assert(
    migrationSql.includes("constraints.convalidated") &&
      migrationSql.includes("not constraints.condeferrable") &&
      migrationSql.includes("not constraints.condeferred"),
    "constraint validation and deferrability states are checked",
  );

  for (const indexName of [
    "host_subscriptions_pkey",
    "host_subscriptions_complimentary_ends_idx",
    "subscription_payments_pkey",
    "subscription_payments_gateway_payment_id_key",
    "idx_subscription_payments_user_id",
  ]) {
    assert(
      compactMigrationSql.includes(
        `index_relations.relname = '${indexName}'`,
      ),
      `precondition validates ${indexName}`,
    );
  }
  assert(
    migrationSql.includes("indexes.indisunique") &&
      migrationSql.includes("indexes.indisprimary") &&
      migrationSql.includes("indexes.indisvalid") &&
      migrationSql.includes("indexes.indisready") &&
      migrationSql.includes("indexes.indnkeyatts = 1") &&
      migrationSql.includes("indexes.indnatts = 1") &&
      migrationSql.includes("indexes.indexprs is null") &&
      migrationSql.includes("indexes.indpred"),
    "index state, keys, expressions, and predicates are checked",
  );
  assert(
    migrationSql.includes(
      "unexpected host_subscriptions index inventory",
    ) &&
      migrationSql.includes(
        "unexpected subscription_payments index inventory",
      ),
    "exact index inventory counts are owned",
  );

  assert(
    !migrationSql.includes("pg_catalog.array["),
    "policy validation rejects schema-qualified ARRAY syntax",
  );
  assert(
    !migrationSql.includes("pg_catalog.coalesce("),
    "migration contains no schema-qualified COALESCE special form",
  );
  assert(
    migrationSql.includes(
      "from pg_catalog.unnest(policies.polroles)",
    ) &&
      migrationSql.includes(
        "roles.rolname = 'authenticated'",
      ) &&
      migrationSql.includes(
        "roles.rolname is distinct from 'authenticated'",
      ) &&
      migrationSql.includes(
        "pg_catalog.cardinality(policies.polroles) = 1",
      ),
    "policy validation requires exactly the authenticated role",
  );
  assert(
    migrationSql.includes(
      'create policy "hosts read own payments"',
    ) &&
      migrationSql.includes("to authenticated") &&
      migrationSql.includes(
        "using (auth.uid() = user_id)",
      ),
    "authenticated payment self-read policy is established",
  );

  assert(
    canonicalPayments.includes("subscription_id uuid") &&
      canonicalPayments.includes(
        "gateway_payment_id varchar(255) unique",
      ) &&
      canonicalPayments.includes("amount_paid numeric(10, 2)") &&
      canonicalPayments.includes("net_revenue numeric(10, 2)") &&
      canonicalPayments.includes("gateway_fee numeric(10, 2)") &&
      canonicalPayments.includes("payment_status varchar(50)") &&
      canonicalPayments.includes(
        "paid_at timestamptz default now()",
      ),
    "canonical schema preserves every legacy payment column",
  );
  assert(
    canonicalPayments.includes("amount_usd numeric(10, 2)") &&
      canonicalPayments.includes("status text check") &&
      canonicalPayments.includes(
        "provider_payment_id text unique",
      ),
    "canonical schema includes the newer payment family",
  );
  assert(
    !canonicalPayments.includes(
      "amount_usd numeric(10, 2) not null",
    ) &&
      !canonicalPayments.includes("status text not null"),
    "newer amount and status permit legacy-only writers",
  );

  console.log(
    "subscription billing schema compatibility tests passed",
  );
}

runSubscriptionBillingSchemaCompatibilityTests();