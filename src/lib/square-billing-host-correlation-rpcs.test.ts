import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20260915140000_square_billing_host_correlation_rpcs.sql";
const OWNER_STATUS_MIGRATION =
  "20260915180000_square_billing_host_correlation_rpc_owner_status.sql";
const UPSERT_AMBIGUITY_MIGRATION =
  "20260916143000_square_billing_upsert_host_correlation_user_id_ambiguity.sql";
const ACL_MIGRATION =
  "20260910130000_subscription_billing_acl_normalization.sql";
const RPC_START = "-- BEGIN square billing host correlation RPCs";
const RPC_END = "-- END square billing host correlation RPCs";
const OWNER_STATUS_START =
  "-- BEGIN square billing host correlation RPC owner and status";
const OWNER_STATUS_END =
  "-- END square billing host correlation RPC owner and status";
const UPSERT_AMBIGUITY_START =
  "-- BEGIN square billing upsert host correlation user_id ambiguity";
const UPSERT_AMBIGUITY_END =
  "-- END square billing upsert host correlation user_id ambiguity";
const ACL_START = "-- BEGIN subscription billing ACL normalization";
const ACL_END = "-- END subscription billing ACL normalization";
const UPSERT_FN =
  "create or replace function public.square_billing_upsert_host_square_correlation(";

const ALLOWLIST_RETURN_COLUMNS = [
  "user_id",
  "plan_id",
  "billing_cycle",
  "billing_amount_usd",
  "square_environment",
  "square_location_id",
  "square_plan_variation_id",
  "square_customer_id",
  "square_subscription_id",
  "square_subscription_status",
  "square_subscription_version",
  "square_start_date",
  "square_charged_through_date",
  "square_canceled_date",
  "complimentary_ends_at",
] as const;

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
  return normalized.slice(start, end + endMarker.length).trim();
}

function stripComments(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function extractUpsertFunction(sql: string) {
  const start = sql.indexOf(UPSERT_FN);
  assert(start >= 0, "upsert function is defined");
  const end = sql.indexOf("\n$$;", start);
  assert(end > start, "upsert function body ends");
  return sql.slice(start, end + 4).trim();
}

function runSquareBillingHostCorrelationRpcTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationSql = normalizeLineEndings(
    readFileSync(join(migrationsDir, EXPECTED_MIGRATION), "utf8"),
  );
  const ownerStatusSql = normalizeLineEndings(
    readFileSync(join(migrationsDir, OWNER_STATUS_MIGRATION), "utf8"),
  );
  const upsertAmbiguitySql = normalizeLineEndings(
    readFileSync(join(migrationsDir, UPSERT_AMBIGUITY_MIGRATION), "utf8"),
  );
  const aclMigrationSql = normalizeLineEndings(
    readFileSync(join(migrationsDir, ACL_MIGRATION), "utf8"),
  );
  const enrollSource = readFileSync(
    join(root, "src/lib/square-subscription-enroll.ts"),
    "utf8",
  );
  const storesSource = readFileSync(
    join(root, "src/lib/square-billing-stores.ts"),
    "utf8",
  );
  const schemaSql = normalizeLineEndings(
    readFileSync(join(root, "supabase", "schema.sql"), "utf8"),
  );
  const storeSource = readFileSync(
    join(root, "src/lib/square-billing-supabase-stores.ts"),
    "utf8",
  );

  assert(
    migrationNames.includes(EXPECTED_MIGRATION),
    "host correlation RPC migration exists",
  );
  assert(
    migrationNames.filter((name) => name.startsWith("20260915140000_"))
      .length === 1,
    "host correlation RPC migration timestamp is unique",
  );
  assert(
    migrationNames.includes(OWNER_STATUS_MIGRATION),
    "RPC owner/status migration exists",
  );
  assert(
    migrationNames.filter((name) => name.startsWith("20260915180000_"))
      .length === 1,
    "RPC owner/status migration timestamp is unique",
  );
  assert(
    migrationNames.includes(UPSERT_AMBIGUITY_MIGRATION),
    "upsert user_id ambiguity migration exists",
  );
  assert(
    migrationNames.filter((name) => name.startsWith("20260916143000_"))
      .length === 1,
    "upsert user_id ambiguity migration timestamp is unique",
  );
  assert(
    migrationNames[migrationNames.length - 1] === UPSERT_AMBIGUITY_MIGRATION,
    "upsert user_id ambiguity migration is latest",
  );
  assert(
    migrationNames.indexOf(OWNER_STATUS_MIGRATION) >
      migrationNames.indexOf(EXPECTED_MIGRATION),
    "owner/status migration follows original RPC migration",
  );
  assert(
    migrationNames.indexOf(UPSERT_AMBIGUITY_MIGRATION) >
      migrationNames.indexOf(OWNER_STATUS_MIGRATION),
    "user_id ambiguity migration follows owner/status",
  );
  assert(
    migrationNames.indexOf(EXPECTED_MIGRATION) >
      migrationNames.indexOf(ACL_MIGRATION),
    "RPCs follow canonical 7D1 ACL normalization",
  );

  assert(
    /^begin;\n/.test(ownerStatusSql) || /\nbegin;\n/.test(ownerStatusSql),
    "owner/status migration starts a transaction",
  );
  assert(/\ncommit;\s*$/.test(ownerStatusSql), "owner/status migration commits");
  assert(
    /^begin;\n/.test(upsertAmbiguitySql) || /\nbegin;\n/.test(upsertAmbiguitySql),
    "user_id ambiguity migration starts a transaction",
  );
  assert(
    /\ncommit;\s*$/.test(upsertAmbiguitySql),
    "user_id ambiguity migration commits",
  );

  const migrationRpc = extractMarkedSection(migrationSql, RPC_START, RPC_END);
  const schemaRpc = extractMarkedSection(schemaSql, RPC_START, RPC_END);
  const ownerStatusSection = extractMarkedSection(
    ownerStatusSql,
    OWNER_STATUS_START,
    OWNER_STATUS_END,
  );
  const ambiguitySection = extractMarkedSection(
    upsertAmbiguitySql,
    UPSERT_AMBIGUITY_START,
    UPSERT_AMBIGUITY_END,
  );
  const schemaUpsert = extractUpsertFunction(schemaRpc);
  const ambiguityUpsert = extractUpsertFunction(ambiguitySection);
  assert(
    schemaUpsert === ambiguityUpsert,
    "schema upsert body matches user_id ambiguity migration",
  );
  assert(
    extractUpsertFunction(ownerStatusSection).includes("on conflict (user_id)"),
    "historical owner/status upsert still documents the 42702 ON CONFLICT target",
  );

  const aclMigrationContract = extractMarkedSection(
    aclMigrationSql,
    ACL_START,
    ACL_END,
  );
  const schemaAclContract = extractMarkedSection(schemaSql, ACL_START, ACL_END);
  assert(
    aclMigrationContract === schemaAclContract,
    "canonical 7D1 ACL contract remains mirrored and unchanged",
  );
  assert(
    !migrationSql.includes(ACL_START) &&
      !/\bgrant\s+(select|insert|update|delete)\b[\s\S]*?\bhost_subscriptions\b/i.test(
        stripComments(migrationSql),
      ),
    "RPC migration does not grant table SELECT/INSERT/UPDATE/DELETE on host_subscriptions",
  );
  assert(
    !ownerStatusSql.includes(ACL_START) &&
      !/\bgrant\s+(select|insert|update|delete)\b[\s\S]*?\bhost_subscriptions\b/i.test(
        stripComments(ownerStatusSql),
      ),
    "owner/status migration does not grant table DML on host_subscriptions",
  );
  assert(
    !/\brevoke\s+all\s+on\s+table\s+public\.host_subscriptions\b/i.test(
      ownerStatusSql,
    ),
    "owner/status migration does not rewrite host_subscriptions table ACL",
  );
  assert(
    !upsertAmbiguitySql.includes(ACL_START) &&
      !/\bgrant\s+(select|insert|update|delete)\b[\s\S]*?\bhost_subscriptions\b/i.test(
        stripComments(upsertAmbiguitySql),
      ),
    "user_id ambiguity migration does not grant table DML on host_subscriptions",
  );
  assert(
    !/\brevoke\s+all\s+on\s+table\s+public\.host_subscriptions\b/i.test(
      upsertAmbiguitySql,
    ),
    "user_id ambiguity migration does not rewrite host_subscriptions table ACL",
  );

  for (const fn of [
    "square_billing_host_customer_owners",
    "square_billing_host_by_subscription",
    "square_billing_upsert_host_square_correlation",
  ]) {
    assert(
      migrationRpc.includes(`create or replace function public.${fn}(`),
      `${fn} is defined`,
    );
    assert(
      migrationRpc.includes("security definer"),
      `${fn} security definer present in contract`,
    );
    assert(
      migrationRpc.includes("set search_path = pg_catalog"),
      `${fn} locks search_path`,
    );
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        migrationRpc.includes(`from ${role};`) ||
          migrationRpc.includes(`from ${role}\n`),
        `${fn} revokes ${role}`,
      );
      assert(
        new RegExp(
          `revoke all on function public\\.${fn}\\([\\s\\S]*?\\) from ${role};`,
          "i",
        ).test(migrationRpc),
        `${fn} has explicit revoke from ${role}`,
      );
    }
    assert(
      new RegExp(
        `grant execute on function public\\.${fn}\\([\\s\\S]*?\\) to service_role;`,
        "i",
      ).test(migrationRpc),
      `${fn} grants execute only to service_role`,
    );
    assert(
      !new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*? to anon;`, "i")
        .test(migrationRpc),
      `${fn} does not grant execute to anon`,
    );
    assert(
      !new RegExp(
        `grant execute on function public\\.${fn}[\\s\\S]*? to authenticated;`,
        "i",
      ).test(migrationRpc),
      `${fn} does not grant execute to authenticated`,
    );
  }

  assert(
    migrationRpc.includes("returns table (\n  user_id pg_catalog.uuid\n)"),
    "RPC A returns only user_id",
  );
  assert(
    !/square_billing_host_customer_owners[\s\S]*?email/i.test(
      migrationRpc.slice(
        migrationRpc.indexOf("square_billing_host_customer_owners"),
        migrationRpc.indexOf("square_billing_host_by_subscription"),
      ),
    ),
    "RPC A does not expose email or unrelated columns",
  );

  for (const column of ALLOWLIST_RETURN_COLUMNS) {
    assert(
      migrationRpc.includes(`${column} pg_catalog.`) ||
        migrationRpc.includes(`${column} pg_catalog.`),
      `allowlist column ${column} appears in RPC return contracts`,
    );
  }
  assert(
    !/complimentary_granted_by|is_lifetime_free|last_payment_at|current_period_end|\bemail\b/.test(
      migrationRpc
        .slice(
          migrationRpc.indexOf("square_billing_upsert_host_square_correlation"),
          migrationRpc.indexOf(
            "revoke all on function public.square_billing_upsert_host_square_correlation",
          ),
        )
        .replace(/message = '[^']*'/g, ""),
    ),
    "RPC B does not read/write email, grantor, lifetime, or unrelated host fields",
  );
  assert(
    ownerStatusSql.includes("v_local_status := 'active'") &&
      ownerStatusSql.includes("v_local_status := 'inactive'") &&
      ownerStatusSql.includes("v_local_status := 'canceled'") &&
      ownerStatusSql.includes("status = excluded.status") &&
      ownerStatusSql.includes("unsupported square subscription status"),
    "upsert maps Square status to local entitlement status and updates it on conflict",
  );
  assert(
    ownerStatusSql.includes("v_subscription_status = 'ACTIVE'") &&
      ownerStatusSql.includes("v_subscription_status = 'PENDING'") &&
      ownerStatusSql.includes("v_subscription_status = 'PAUSED'") &&
      ownerStatusSql.includes("v_subscription_status = 'DEACTIVATED'") &&
      ownerStatusSql.includes("v_subscription_status = 'CANCELED'"),
    "upsert maps ACTIVE/PENDING/PAUSED/CANCELED/DEACTIVATED",
  );
  for (const fn of [
    "square_billing_host_customer_owners",
    "square_billing_host_by_subscription",
    "square_billing_upsert_host_square_correlation",
  ]) {
    assert(
      new RegExp(
        `alter function public\\.${fn}\\([\\s\\S]*?\\) owner to postgres;`,
        "i",
      ).test(ownerStatusSql) &&
        new RegExp(
          `alter function public\\.${fn}\\([\\s\\S]*?\\) owner to postgres;`,
          "i",
        ).test(schemaSql),
      `${fn} owner is postgres in migration and schema`,
    );
    for (const role of ["public", "anon", "authenticated"]) {
      assert(
        new RegExp(
          `revoke all on function public\\.${fn}\\([\\s\\S]*?\\) from ${role};`,
          "i",
        ).test(ownerStatusSql),
        `owner/status migration revokes ${fn} from ${role}`,
      );
    }
    assert(
      new RegExp(
        `grant execute on function public\\.${fn}\\([\\s\\S]*?\\) to service_role;`,
        "i",
      ).test(ownerStatusSql),
      `owner/status migration grants ${fn} execute to service_role only`,
    );
    assert(
      !new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*? to anon;`, "i")
        .test(ownerStatusSql),
      `owner/status migration does not grant ${fn} to anon`,
    );
    assert(
      !new RegExp(
        `grant execute on function public\\.${fn}[\\s\\S]*? to authenticated;`,
        "i",
      ).test(ownerStatusSql),
      `owner/status migration does not grant ${fn} to authenticated`,
    );
  }
  assert(
    schemaRpc.includes("v_local_status := 'active'") &&
      schemaRpc.includes("status = excluded.status"),
    "schema upsert uses mapped local status",
  );
  assert(
    migrationRpc.includes("monthly_usd = excluded.monthly_usd") &&
      migrationRpc.includes("v_billing_amount_usd"),
    "RPC B sets monthly_usd from billing amount",
  );
  assert(
    migrationRpc.includes("errcode = 'ZB409'"),
    "RPC B raises ZB409 on cross-user ownership conflicts",
  );
  assert(
    migrationRpc.includes("errcode = 'ZB001'"),
    "RPCs raise ZB001 on invalid input",
  );

  assert(
    storeSource.includes('rpc("square_billing_host_customer_owners"'),
    "store wires RPC A",
  );
  assert(
    storeSource.includes("square_billing_upsert_host_square_correlation"),
    "store wires RPC B",
  );
  assert(
    storeSource.includes('rpc("square_billing_host_by_subscription"'),
    "store wires RPC C",
  );
  assert(
    !/\.from\(\s*["']host_subscriptions["']\s*\)/.test(storeSource),
    "store has no direct host_subscriptions table access",
  );
  assert(
    storeSource.includes('error.code === "ZB409"') &&
      storeSource.includes('error.code === "ZB001"'),
    "store maps RPC conflict/invalid codes without leaking SQL",
  );

  const upsertBody = schemaUpsert.slice(schemaUpsert.indexOf("as $$"));
  assert(
    upsertBody.startsWith("as $$\n#variable_conflict use_column\ndeclare"),
    "upsert sets #variable_conflict use_column before DECLARE",
  );
  assert(
    /on conflict on constraint host_subscriptions_pkey do update/.test(
      schemaUpsert,
    ),
    "ON CONFLICT targets host_subscriptions_pkey instead of unqualified user_id",
  );
  assert(
    !/on conflict\s*\(\s*user_id\s*\)/i.test(schemaUpsert),
    "fixed upsert has no ON CONFLICT (user_id)",
  );
  assert(
    !/\bon conflict\s*\(\s*user_id\s*\)/i.test(upsertAmbiguitySql),
    "ambiguity migration has no ON CONFLICT (user_id)",
  );
  assert(
    /where s\.user_id = v_user_id/.test(schemaUpsert) &&
      /and s\.user_id <> v_user_id/.test(schemaUpsert) &&
      /select\s+s\.user_id/.test(schemaUpsert),
    "query user_id references stay table-qualified",
  );
  for (const column of ALLOWLIST_RETURN_COLUMNS) {
    const ambiguousConflict = new RegExp(
      `on conflict\\s*\\(\\s*${column}\\s*\\)`,
      "i",
    );
    assert(
      !ambiguousConflict.test(schemaUpsert),
      `ON CONFLICT does not use unqualified ${column}`,
    );
  }
  assert(
    schemaUpsert.includes("security definer") &&
      schemaUpsert.includes("set search_path = pg_catalog"),
    "fixed upsert keeps SECURITY DEFINER and search_path",
  );
  assert(
    schemaUpsert.includes("v_local_status := 'active'") &&
      schemaUpsert.includes("v_local_status := 'inactive'") &&
      schemaUpsert.includes("v_local_status := 'canceled'") &&
      schemaUpsert.includes("v_subscription_status = 'ACTIVE'") &&
      schemaUpsert.includes("v_subscription_status = 'PENDING'") &&
      schemaUpsert.includes("v_subscription_status = 'PAUSED'") &&
      schemaUpsert.includes("v_subscription_status = 'DEACTIVATED'") &&
      schemaUpsert.includes("v_subscription_status = 'CANCELED'") &&
      schemaUpsert.includes("status = excluded.status"),
    "fixed upsert keeps Square-to-local status mapping",
  );
  assert(
    /return query\s+select[\s\S]*from public\.host_subscriptions as s\s+where s\.user_id = v_user_id/.test(
      schemaUpsert,
    ),
    "fixed upsert keeps RETURN QUERY by aliased user_id",
  );
  for (const role of ["public", "anon", "authenticated"]) {
    assert(
      new RegExp(
        `revoke all on function public\\.square_billing_upsert_host_square_correlation\\([\\s\\S]*?\\) from ${role};`,
        "i",
      ).test(upsertAmbiguitySql),
      `ambiguity migration revokes upsert from ${role}`,
    );
  }
  assert(
    /grant execute on function public\.square_billing_upsert_host_square_correlation\([\s\S]*?\) to service_role;/.test(
      upsertAmbiguitySql,
    ),
    "ambiguity migration grants upsert execute to service_role",
  );
  assert(
    /alter function public\.square_billing_upsert_host_square_correlation\([\s\S]*?\) owner to postgres;/.test(
      upsertAmbiguitySql,
    ),
    "ambiguity migration keeps upsert owner postgres",
  );
  assert(
    /isEnrollableSquareSubscriptionStatus\(subscription\.status\)/.test(
      enrollSource,
    ) &&
      /if \(!isEnrollableSquareSubscriptionStatus\(normalized\.squareSubscriptionStatus\)\)/.test(
        storeSource,
      ),
    "ACTIVE-only persist gate remains in enroll and supabase store",
  );
  assert(
    /export function isEnrollableSquareSubscriptionStatus\(status: string\): boolean \{\s*return status\.trim\(\) === "ACTIVE";/.test(
      storesSource,
    ),
    "only ACTIVE remains enrollable",
  );

  console.log("square-billing-host-correlation-rpcs tests passed");
}

runSquareBillingHostCorrelationRpcTests();
