import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const APPLIED_MIGRATION =
  "20260916200000_square_subscription_status_webhook.sql";
const CORRECTIVE_MIGRATION =
  "20260917000000_square_subscription_equal_version_fail_closed.sql";
const APPLIED_MIGRATION_SHA256 =
  "f437213a92150fe4d457a12208043c6dda1d35e7d549505ef543e5ac4302b2c9";
const FROZEN_6A_MIGRATION =
  "20260908120000_subscription_webhook_replay.sql";
const FROZEN_6A_SHA256 =
  "e86b621cf4d843f988ef19c01121d15063673ffcb197f24c1261561cb71f6ba9";
const APPLIED_CONTRACT_START = "-- BEGIN square subscription status webhook";
const APPLIED_CONTRACT_END = "-- END square subscription status webhook";
const CORRECTIVE_CONTRACT_START =
  "-- BEGIN square subscription equal-version fail-closed";
const CORRECTIVE_CONTRACT_END =
  "-- END square subscription equal-version fail-closed";
const PAYMENT_RPC =
  "create or replace function public.process_subscription_webhook_atomic(";
const STATUS_RPC =
  "create or replace function public.square_billing_apply_subscription_status_webhook(";

function normalize(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizedSha256(path: string) {
  return createHash("sha256")
    .update(normalize(readFileSync(path, "utf8")), "utf8")
    .digest("hex");
}

function extractMarkedSection(sql: string, startMarker: string, endMarker: string) {
  const normalized = normalize(sql);
  const start = normalized.indexOf(startMarker);
  const end = normalized.indexOf(endMarker);
  assert(start >= 0, `${startMarker} exists`);
  assert(end > start, `${endMarker} follows its start marker`);
  return normalized.slice(start, end + endMarker.length).trim();
}

function extractFunction(sql: string, startMarker: string) {
  const start = sql.indexOf(startMarker);
  assert(start >= 0, `${startMarker} is defined`);
  const end = sql.indexOf("\n$$;", start);
  assert(end > start, `${startMarker} body ends`);
  return sql.slice(start, end + 4);
}

function runSquareSubscriptionStatusWebhookSchemaTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const appliedPath = join(migrationsDir, APPLIED_MIGRATION);
  const correctivePath = join(migrationsDir, CORRECTIVE_MIGRATION);
  const schemaPath = join(root, "supabase", "schema.sql");
  const frozen6aPath = join(migrationsDir, FROZEN_6A_MIGRATION);

  assert(existsSync(appliedPath), "applied status webhook migration exists");
  assert(existsSync(correctivePath), "equal-version fail-closed migration exists");
  assert(existsSync(schemaPath), "canonical schema exists");
  assert(existsSync(frozen6aPath), "frozen 6A migration exists");

  const appliedSql = normalize(readFileSync(appliedPath, "utf8"));
  const correctiveSql = normalize(readFileSync(correctivePath, "utf8"));
  const schemaSql = normalize(readFileSync(schemaPath, "utf8"));

  assert(
    normalizedSha256(appliedPath) === APPLIED_MIGRATION_SHA256,
    "applied 20260916200000 migration remains byte-for-byte unchanged",
  );
  assert(
    appliedSql.includes("drop constraint subscription_webhook_events_event_type_check"),
    "applied migration still owns the event_type constraint change",
  );
  assert(
    !correctiveSql.includes("drop constraint subscription_webhook_events_event_type_check"),
    "corrective migration does not rewrite the applied constraint",
  );

  const appliedContract = extractMarkedSection(
    appliedSql,
    APPLIED_CONTRACT_START,
    APPLIED_CONTRACT_END,
  );
  const schemaAppliedContract = extractMarkedSection(
    schemaSql,
    APPLIED_CONTRACT_START,
    APPLIED_CONTRACT_END,
  );
  const correctiveContract = extractMarkedSection(
    correctiveSql,
    CORRECTIVE_CONTRACT_START,
    CORRECTIVE_CONTRACT_END,
  );
  const schemaFunction = extractFunction(schemaAppliedContract, STATUS_RPC);
  const correctiveFunction = extractFunction(correctiveContract, STATUS_RPC);

  assert(
    schemaFunction === correctiveFunction,
    "canonical schema function matches the corrective migration function",
  );
  assert(
    extractFunction(appliedSql, STATUS_RPC) !== correctiveFunction,
    "corrective function differs from the already-applied RPC body",
  );

  const eventTypes = [
    "payment.succeeded",
    "payment.failed",
    "subscription.canceled",
    "subscription.created",
    "subscription.updated",
  ];
  for (const eventType of eventTypes) {
    assert(
      appliedContract.includes(`'${eventType}'`),
      `event type ${eventType} is present`,
    );
  }
  assert(
    /primary key\s*\(\s*provider\s*,\s*event_id\s*\)/i.test(
      readFileSync(frozen6aPath, "utf8"),
    ),
    "primary event identity remains provider+event_id",
  );
  assert(
    correctiveFunction.includes("on conflict (provider, event_id) do nothing"),
    "RPC claims the existing provider+event_id identity",
  );

  assert(
    /\bsecurity definer\b/i.test(correctiveFunction),
    "RPC is SECURITY DEFINER",
  );
  assert(
    /set search_path = pg_catalog\b/i.test(correctiveFunction),
    "search_path is pg_catalog",
  );
  assert(
    /\bsecurity definer\b/i.test(appliedContract) &&
      /set search_path = pg_catalog\b/i.test(appliedContract),
    "applied RPC security settings remain in the frozen file",
  );

  for (const field of [
    "p_square_environment",
    "p_square_subscription_id",
    "p_square_customer_id",
    "p_square_location_id",
    "p_square_plan_variation_id",
  ]) {
    assert(
      correctiveFunction.includes(field),
      `full correlation field ${field} is required`,
    );
  }
  assert(
    correctiveFunction.includes("s.square_environment = v_environment") &&
      correctiveFunction.includes("s.square_subscription_id = v_subscription_id") &&
      correctiveFunction.includes("s.square_customer_id = v_customer_id") &&
      correctiveFunction.includes("s.square_location_id = v_location_id") &&
      correctiveFunction.includes(
        "s.square_plan_variation_id = v_plan_variation_id",
      ),
    "host lookup uses the complete Square correlation",
  );
  assert(
    correctiveFunction.includes("s.square_subscription_status") &&
      correctiveFunction.includes("v_stored_square_status"),
    "stored square_subscription_status is read",
  );

  assert(
    correctiveFunction.includes("v_stored_version > v_incoming_version") &&
      correctiveFunction.includes("v_apply_host := false"),
    "greater stored version skips host writes",
  );
  assert(
    correctiveFunction.includes(
      "v_stored_square_status is not distinct from v_square_status",
    ),
    "equal same-status events skip as idempotent",
  );
  assert(
    correctiveFunction.includes("v_stored_square_status = 'ACTIVE'") &&
      correctiveFunction.includes("v_square_status = 'DEACTIVATED'") &&
      correctiveFunction.includes("v_apply_host := true"),
    "equal ACTIVE to DEACTIVATED applies",
  );
  assert(
    correctiveFunction.includes("v_square_status = 'CANCELED'") &&
      correctiveFunction.includes("v_stored_square_status = 'ACTIVE'"),
    "equal ACTIVE to CANCELED applies",
  );
  assert(
    correctiveFunction.includes(
      "v_stored_square_status is distinct from 'ACTIVE'",
    ) &&
      correctiveFunction.includes("v_square_status = 'ACTIVE'") &&
      /v_stored_square_status is distinct from 'ACTIVE'\s*\n\s*and v_square_status = 'ACTIVE' then\s*\n\s*v_apply_host := false/m.test(
        correctiveFunction,
      ),
    "equal non-ACTIVE to ACTIVE skips fail-closed",
  );
  assert(
    /else\s*\n\s*v_apply_host := false/m.test(correctiveFunction),
    "equal different non-ACTIVE statuses skip fail-closed",
  );
  assert(
    correctiveFunction.includes("v_stored_version is null") &&
      correctiveFunction.includes("v_incoming_version > v_stored_version") &&
      /elsif v_stored_version is null\s*\n\s*or v_incoming_version > v_stored_version then\s*\n\s*v_apply_host := true/m.test(
        correctiveFunction,
      ),
    "newer or missing stored version applies incoming state including ACTIVE",
  );
  assert(
    correctiveFunction.includes(
      "square_subscription_version = v_incoming_version",
    ) &&
      correctiveFunction.includes(
        "s.square_subscription_version <= v_incoming_version",
      ) &&
      !/square_subscription_version\s*=\s*null/i.test(correctiveFunction),
    "stored version is never reduced or set to null",
  );

  assert(
    correctiveFunction.includes("when 'ACTIVE' then 'active'") &&
      correctiveFunction.includes("when 'CANCELED' then 'canceled'") &&
      correctiveFunction.includes("else 'inactive'"),
    "ACTIVE and CANCELED map explicitly; remaining statuses map to inactive",
  );
  for (const status of [
    "ACTIVE",
    "PENDING",
    "PAUSED",
    "DEACTIVATED",
    "COMPLETED",
    "CANCELED",
  ]) {
    assert(
      correctiveFunction.includes(`'${status}'`),
      `Square status ${status} is accepted`,
    );
  }

  assert(
    !/insert\s+into\s+public\.host_subscriptions\b/i.test(correctiveFunction),
    "unknown correlation cannot insert a host row",
  );
  assert(
    correctiveFunction.includes("skipped_host := true"),
    "unknown or stale correlation finalizes as skipped",
  );
  assert(
    correctiveFunction.includes("status = 'processed'") &&
      correctiveFunction.includes("e.status = 'processing'"),
    "claimed events are finalized processed instead of remaining stuck",
  );

  assert(
    correctiveContract.includes(
      "revoke all on function public.square_billing_apply_subscription_status_webhook",
    ) &&
      correctiveContract.includes(") from public") &&
      correctiveContract.includes(") from anon") &&
      correctiveContract.includes(") from authenticated"),
    "function is revoked from public/anon/authenticated",
  );
  assert(
    correctiveContract.includes(
      "grant execute on function public.square_billing_apply_subscription_status_webhook",
    ) && correctiveContract.includes(") to service_role"),
    "execute is granted only to service_role",
  );
  assert(
    !/grant execute[\s\S]{0,1200}\) to (public|anon|authenticated)/i.test(
      correctiveContract,
    ),
    "no client execute grant",
  );
  assert(
    !/\bgrant\s+(select|insert|update|delete|all)\s+on table public\.subscription_webhook_events\b/i.test(
      correctiveContract,
    ),
    "table-level ledger ACL is unchanged",
  );
  assert(
    !/\bcreate\s+policy\b/i.test(correctiveContract),
    "RLS policies are unchanged",
  );

  assert(
    normalizedSha256(frozen6aPath) === FROZEN_6A_SHA256,
    "frozen 6A migration remains untouched",
  );

  const paymentRpc = extractFunction(schemaSql, PAYMENT_RPC);
  assert(
    paymentRpc.includes("v_event_type <> 'payment.succeeded'") &&
      paymentRpc.includes("v_event_type <> 'payment.failed'") &&
      paymentRpc.includes("v_event_type <> 'subscription.canceled'"),
    "existing payment RPC still accepts only its original event types",
  );
  assert(
    !paymentRpc.includes("subscription.created") &&
      !paymentRpc.includes("subscription.updated"),
    "existing payment RPC remains unchanged for created/updated events",
  );
  assert(
    !appliedSql.includes(PAYMENT_RPC) && !correctiveSql.includes(PAYMENT_RPC),
    "status webhook migrations do not replace the payment RPC",
  );

  assert(
    !/\.\.\.|TODO|FIXME|pseudocode/i.test(appliedSql) &&
      !/\.\.\.|TODO|FIXME|pseudocode/i.test(correctiveSql),
    "migrations contain no ellipses, TODOs, or pseudocode placeholders",
  );

  const webhookReplayStart = schemaSql.indexOf(
    "-- BEGIN subscription webhook replay contract",
  );
  const webhookReplayEnd = schemaSql.indexOf(
    "-- END subscription webhook replay contract",
  );
  assert(
    webhookReplayStart >= 0 && webhookReplayEnd > webhookReplayStart,
    "frozen webhook replay markers remain in schema.sql",
  );
  const frozenSchemaBlock = schemaSql.slice(
    webhookReplayStart,
    webhookReplayEnd,
  );
  assert(
    schemaSql.indexOf(APPLIED_CONTRACT_START) > webhookReplayEnd,
    "status webhook contract is outside the frozen replay marker block",
  );
  assert(
    !frozenSchemaBlock.includes(STATUS_RPC),
    "status webhook RPC is not inside the frozen replay block",
  );

  const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  assert(
    names.filter((name) => name.startsWith("20260916200000_")).length === 1,
    "applied status webhook migration timestamp is unique",
  );
  assert(
    names.filter((name) => name.startsWith("20260917000000_")).length === 1,
    "corrective equal-version migration timestamp is unique",
  );

  console.log("square subscription status webhook schema tests passed");
}

runSquareSubscriptionStatusWebhookSchemaTests();
