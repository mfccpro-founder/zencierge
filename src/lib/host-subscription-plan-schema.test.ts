import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ZENCIERGE_PLAN_IDS,
  ZENCIERGE_PLANS,
} from "./zencierge-plans";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20260908123000_host_subscription_plan_catalog.sql";
const REPLAY_MIGRATION =
  "20260908120000_subscription_webhook_replay.sql";
const REPLAY_MIGRATION_NORMALIZED_SHA256 =
  "3cabf8c583dd7d7f694e65a1e756ecc432a59f0ae2892a0d3a16e32fe558cf7d";
const SCHEMA_SECTION_START =
  "create table if not exists public.host_subscriptions (";
const SCHEMA_SECTION_END =
  "alter table public.host_subscriptions add column if not exists is_lifetime_free";
const EXPECTED_PLANS = [
  "starter",
  "pro",
  "portfolio",
  "agency",
] as const;

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizedSha256File(path: string) {
  const normalized = normalizeLineEndings(
    readFileSync(path, "utf8"),
  );
  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex");
}

function extractCanonicalHostSubscriptions(sql: string) {
  const start = sql.indexOf(SCHEMA_SECTION_START);
  const end = sql.indexOf(SCHEMA_SECTION_END);
  assert(start >= 0, "canonical host_subscriptions section starts");
  assert(end > start, "canonical host_subscriptions section ends after start");
  return sql.slice(start, end);
}

function planConstraintValues(sql: string, label: string) {
  const match =
    /check\s*\(\s*plan_id\s+in\s*\(([^)]*)\)\s*\)/i.exec(sql);
  assert(Boolean(match), `${label} plan constraint exists`);

  return [
    ...(match?.[1].matchAll(/'([^']+)'/g) ?? []),
  ].map((item) => item[1]);
}

function runHostSubscriptionPlanSchemaTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationSql = readFileSync(
    join(migrationsDir, EXPECTED_MIGRATION),
    "utf8",
  );
  const schemaSql = readFileSync(
    join(root, "supabase", "schema.sql"),
    "utf8",
  );
  const canonicalHostSubscriptions =
    extractCanonicalHostSubscriptions(schemaSql);

  assert(
    migrationNames.includes(EXPECTED_MIGRATION),
    "host subscription plan migration exists",
  );
  assert(
    migrationNames.filter(
      (name) => name.startsWith("20260908123000_"),
    ).length === 1,
    "host subscription plan migration timestamp is unique",
  );
  assert(
    migrationNames.includes(REPLAY_MIGRATION),
    "Microblock 6A migration remains present",
  );

  const migrationIndex = migrationNames.indexOf(EXPECTED_MIGRATION);
  assert(
    migrationIndex > 0,
    "host subscription plan migration has a historical predecessor",
  );
  assert(
    migrationNames[migrationIndex - 1] === REPLAY_MIGRATION,
    "host subscription plan migration follows Microblock 6A directly",
  );

  assert(
    JSON.stringify(ZENCIERGE_PLAN_IDS) ===
      JSON.stringify(EXPECTED_PLANS),
    "application catalog contains exactly four approved plan IDs",
  );
  assert(
    ZENCIERGE_PLANS.starter.monthlyUsd === 49,
    "Starter catalog price is 49",
  );
  assert(
    ZENCIERGE_PLANS.portfolio.monthlyUsd === 149,
    "Portfolio catalog price remains 149",
  );

  const schemaPlans = planConstraintValues(
    canonicalHostSubscriptions,
    "canonical host_subscriptions",
  );
  const migrationPlans = planConstraintValues(
    migrationSql,
    "migration",
  );
  assert(
    JSON.stringify(schemaPlans) ===
      JSON.stringify(EXPECTED_PLANS),
    "canonical constraint permits exactly the application plans",
  );
  assert(
    JSON.stringify(migrationPlans) ===
      JSON.stringify(EXPECTED_PLANS),
    "migration constraint permits exactly the application plans",
  );
  assert(
    JSON.stringify(schemaPlans) ===
      JSON.stringify(migrationPlans),
    "canonical and migration plan constraints align",
  );

  assert(
    /monthly_usd\s+numeric\(10,\s*2\)\s+not null\s+default\s+49\b/i.test(
      canonicalHostSubscriptions,
    ),
    "canonical monthly_usd default is 49",
  );
  assert(
    /alter\s+column\s+monthly_usd\s+set\s+default\s+49\b/i.test(
      migrationSql,
    ),
    "migration sets monthly_usd default to 49",
  );
  assert(
    ZENCIERGE_PLANS.starter.monthlyUsd === 49 &&
      /default\s+49\b/i.test(canonicalHostSubscriptions) &&
      /set\s+default\s+49\b/i.test(migrationSql),
    "database default matches the Starter catalog price",
  );

  assert(
    /drop\s+constraint\s+host_subscriptions_plan_id_check\s*;/i.test(
      migrationSql,
    ),
    "migration strictly drops the expected plan constraint",
  );
  assert(
    !/drop\s+constraint\s+if\s+exists/i.test(migrationSql),
    "migration does not silently ignore a missing expected constraint",
  );
  assert(
    /add\s+constraint\s+host_subscriptions_plan_id_check\s+check/i.test(
      migrationSql,
    ),
    "migration recreates the explicit stable plan constraint name",
  );

  const publicObjects = [
    ...migrationSql.matchAll(/\bpublic\.([a-z0-9_]+)/gi),
  ].map((match) => match[1].toLowerCase());
  assert(
    publicObjects.length > 0 &&
      publicObjects.every(
        (name) => name === "host_subscriptions",
      ),
    "migration changes only public.host_subscriptions",
  );
  assert(
    !/\b(update|insert(?:\s+into)?|delete(?:\s+from)?|merge(?:\s+into)?|truncate|copy)\b/i.test(
      migrationSql,
    ),
    "migration performs no customer-row writes",
  );
  assert(
    !/\bbackfill\b/i.test(migrationSql),
    "migration performs no backfill",
  );
  assert(
    !/\bexecute\b|\bformat\s*\(|create\s+(or\s+replace\s+)?function/i.test(
      migrationSql,
    ),
    "migration uses no dynamic SQL or functions",
  );

  assert(
    !/subscription_webhook_events|process_subscription_webhook_atomic/i.test(
      migrationSql,
    ),
    "migration does not change replay ledger or RPC",
  );
  assert(
    !/complimentary_|square_customer_id|square_subscription_id|status\s*=/i.test(
      migrationSql,
    ),
    "migration does not change complimentary, Square ID, or status fields",
  );
  assert(
    !/\b(route|checkout|component|authentication|reconciliation)\b/i.test(
      migrationSql,
    ),
    "migration contains no route, checkout, UI, auth, or reconciliation work",
  );

  assert(
    normalizedSha256File(
      join(migrationsDir, REPLAY_MIGRATION),
    ) === REPLAY_MIGRATION_NORMALIZED_SHA256,
    "Microblock 6A migration remains unchanged after line-ending normalization",
  );

  console.log(
    "host subscription plan schema alignment tests passed",
  );
}

try {
  runHostSubscriptionPlanSchemaTests();
} catch (error: unknown) {
  console.error(
    error instanceof Error
      ? error.message
      : "host subscription plan schema tests failed",
  );
  process.exitCode = 1;
}