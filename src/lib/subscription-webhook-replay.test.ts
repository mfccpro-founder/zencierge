import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20260908120000_subscription_webhook_replay.sql";
const EXPECTED_PREVIOUS_MIGRATION =
  "20260908110000_subscription_billing_schema_compatibility.sql";
const EXPECTED_NORMALIZED_SHA256 =
  "e86b621cf4d843f988ef19c01121d15063673ffcb197f24c1261561cb71f6ba9";
const CONTRACT_START =
  "-- BEGIN subscription webhook replay contract";
const CONTRACT_END =
  "-- END subscription webhook replay contract";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizedSha256(value: string) {
  return createHash("sha256")
    .update(normalizeLineEndings(value), "utf8")
    .digest("hex");
}

function extractContract(sql: string) {
  const start = sql.indexOf(CONTRACT_START);
  const end = sql.indexOf(CONTRACT_END);
  assert(start >= 0, "replay contract start marker exists");
  assert(end > start, "replay contract end marker exists");
  return normalizeLineEndings(
    sql.slice(start, end + CONTRACT_END.length),
  ).trim();
}

function functionBody(sql: string) {
  const start = sql.indexOf(
    "create or replace function public.process_subscription_webhook_atomic",
  );
  const bodyStart = sql.indexOf("as $$", start);
  const bodyEnd = sql.indexOf("$$;", bodyStart);
  assert(start >= 0, "atomic webhook RPC exists");
  assert(bodyStart > start, "atomic webhook RPC body starts");
  assert(bodyEnd > bodyStart, "atomic webhook RPC body ends");
  return sql.slice(bodyStart, bodyEnd);
}

function runSubscriptionWebhookReplayTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationPath = join(migrationsDir, EXPECTED_MIGRATION);
  const migrationSql = readFileSync(migrationPath, "utf8");

  assert(
    migrationNames.includes(EXPECTED_MIGRATION),
    "expected replay migration exists",
  );
  assert(
    migrationNames.filter(
      (name) => name.startsWith("20260908120000_"),
    ).length === 1,
    "replay migration timestamp is unique",
  );
  const replayMigrationIndex =
    migrationNames.indexOf(EXPECTED_MIGRATION);

  assert(
    replayMigrationIndex > 0,
    "replay migration has a previous migration",
  );
  assert(
    migrationNames[replayMigrationIndex - 1] ===
      EXPECTED_PREVIOUS_MIGRATION,
    "replay migration follows its expected historical predecessor",
  );
  assert(
    normalizedSha256(migrationSql) === EXPECTED_NORMALIZED_SHA256,
    "historical replay migration remains unchanged after line-ending normalization",
  );

  const migrationContract = extractContract(migrationSql);

  for (const [label, sql] of [
    ["historical migration", migrationContract],
  ] as const) {
    assert(
      sql.includes(
        "create table if not exists public.subscription_webhook_events",
      ),
      `${label} defines the durable replay ledger`,
    );
    assert(
      /primary key\s*\(\s*provider\s*,\s*event_id\s*\)/i.test(sql),
      `${label} uses provider and event_id as the composite key`,
    );
    assert(
      sql.includes(
        "provider in ('square', 'generic_subscription')",
      ),
      `${label} restricts provider values`,
    );
    assert(
      sql.includes("'payment.succeeded'") &&
        sql.includes("'payment.failed'") &&
        sql.includes("'subscription.canceled'"),
      `${label} restricts supported event types`,
    );
    assert(
      sql.includes("status in ('processing', 'processed')"),
      `${label} restricts processing states`,
    );
    assert(
      sql.includes("payload_sha256 ~ '^[0-9a-f]{64}$'"),
      `${label} validates lowercase SHA-256 fingerprints`,
    );
    assert(
      sql.includes(
        "alter table public.subscription_webhook_events enable row level security",
      ),
      `${label} enables replay-ledger RLS`,
    );
    assert(
      sql.includes(
        "revoke all on table public.subscription_webhook_events from public",
      ) &&
        sql.includes(
          "revoke all on table public.subscription_webhook_events from anon",
        ) &&
        sql.includes(
          "revoke all on table public.subscription_webhook_events from authenticated",
        ),
      `${label} revokes client ledger access`,
    );
    assert(
      sql.includes(
        "grant select on table public.subscription_webhook_events to service_role",
      ),
      `${label} grants only service-role ledger inspection`,
    );
    assert(
      sql.includes(
        "create or replace function public.process_subscription_webhook_atomic",
      ),
      `${label} defines the atomic processor`,
    );
    assert(
      /\blanguage plpgsql\b/i.test(sql),
      `${label} RPC uses PL/pgSQL`,
    );
    assert(
      /\bsecurity definer\b/i.test(sql),
      `${label} RPC is SECURITY DEFINER`,
    );
    assert(
      /set search_path = pg_catalog\b/i.test(sql),
      `${label} RPC fixes search_path`,
    );
    assert(
      sql.includes(
        "grant execute on function public.process_subscription_webhook_atomic",
      ) &&
        sql.includes(") to service_role"),
      `${label} grants RPC execution to service_role`,
    );
    assert(
      !/grant execute[\s\S]{0,900}\) to (public|anon|authenticated)/i.test(
        sql,
      ),
      `${label} grants no client RPC execution`,
    );

    const body = functionBody(sql);
    assert(
      !/\bexecute\b/i.test(body),
      `${label} RPC contains no dynamic SQL`,
    );
    assert(
      !/\bexception\s+when\b/i.test(body),
      `${label} RPC does not swallow transaction failures`,
    );
    assert(
      !/\b(commit|rollback)\b/i.test(body),
      `${label} RPC leaves transaction control to PostgreSQL`,
    );

    const claimAt = body.indexOf(
      "insert into public.subscription_webhook_events",
    );
    const paymentWriteAt = body.indexOf(
      "insert into public.subscription_payments",
    );
    const subscriptionWriteAt = body.indexOf(
      "insert into public.host_subscriptions",
    );
    const processedWriteAt = body.lastIndexOf(
      "status = 'processed'",
    );
    assert(claimAt >= 0, `${label} atomically claims the event`);
    assert(
      paymentWriteAt > claimAt,
      `${label} claims before payment writes`,
    );
    assert(
      subscriptionWriteAt > claimAt,
      `${label} claims before subscription writes`,
    );
    assert(
      processedWriteAt > paymentWriteAt &&
        processedWriteAt > subscriptionWriteAt,
      `${label} marks processed after downstream writes`,
    );

    const replayAt = body.indexOf(
      "if v_existing_status = 'processed' then",
    );
    const replayReturnAt = body.indexOf("return;", replayAt);
    assert(
      replayAt > claimAt &&
        replayReturnAt > replayAt &&
        replayReturnAt < paymentWriteAt,
      `${label} replay returns before downstream writes`,
    );
    assert(
      body.includes(
        "v_existing_payload_sha256 is distinct from p_payload_sha256",
      ) &&
        body.includes(
          "message = 'webhook event identity conflict'",
        ),
      `${label} rejects altered payload reuse`,
    );
    assert(
      body.includes(
        "message = 'webhook event processing state conflict'",
      ),
      `${label} fails closed for unexpected processing rows`,
    );

    const paymentValidationAt = body.indexOf(
      "if v_event_type = 'payment.succeeded'",
    );
    assert(
      paymentValidationAt >= 0 &&
        body.indexOf(
          "v_payment_id := pg_catalog.btrim(p_payment_id)",
          paymentValidationAt,
        ) > paymentValidationAt &&
        body.indexOf("p_amount_usd <= 0", paymentValidationAt) >
          paymentValidationAt,
      `${label} validates payment identity and positive amount`,
    );
    assert(
      body.includes("p_amount_usd::pg_catalog.text in") &&
        body.includes("'NaN'") &&
        body.includes("'Infinity'") &&
        body.includes("'-Infinity'"),
      `${label} rejects non-finite payment amounts`,
    );
    assert(
      body.includes("amount_usd") &&
        body.includes("p_amount_usd") &&
        body.includes("provider_payment_id") &&
        body.includes("v_payment_id"),
      `${label} persists exact normalized payment values`,
    );
    assert(
      body.includes("on conflict (provider_payment_id) do update"),
      `${label} preserves provider payment ID conflict protection`,
    );
    assert(
      body.includes(
        "v_event_type = 'payment.succeeded'\n     or v_event_type = 'payment.failed'",
      ) &&
        body.includes("else\n    v_payment_id := null;"),
      `${label} does not require payment values for cancellation`,
    );
  }

  assert(
    !/raw_body|signature|secret|access_token|card_number/i.test(
      migrationContract,
    ),
    "ledger stores no raw body, signatures, secrets, tokens, or card data",
  );

  console.log("subscription webhook replay SQL contract tests passed");
}

runSubscriptionWebhookReplayTests();