import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_MIGRATION =
  "20261013190000_stripe_sandbox_billing_correlation.sql";
const EXPECTED_PREVIOUS_MIGRATION =
  "20260928200000_host_tts_meter_backoffice_read.sql";
const SCHEMA_START = "-- BEGIN stripe sandbox billing correlation schema";
const SCHEMA_END = "-- END stripe sandbox billing correlation schema";
const RPC_START = "-- BEGIN stripe sandbox billing correlation RPCs";
const RPC_END = "-- END stripe sandbox billing correlation RPCs";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

function runStripeSandboxBillingCorrelationSchemaTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationSql = normalizeLineEndings(
    readFileSync(join(migrationsDir, EXPECTED_MIGRATION), "utf8"),
  );
  const schema = extractMarkedSection(migrationSql, SCHEMA_START, SCHEMA_END);
  const rpcs = extractMarkedSection(migrationSql, RPC_START, RPC_END);

  assert(
    migrationNames.includes(EXPECTED_MIGRATION),
    "Stripe Sandbox correlation migration exists",
  );
  assert(
    migrationNames.filter((name) => name.startsWith("20261013190000_"))
      .length === 1,
    "Stripe Sandbox correlation timestamp is unique",
  );
  const index = migrationNames.indexOf(EXPECTED_MIGRATION);
  assert(
    index > 0 && migrationNames[index - 1] === EXPECTED_PREVIOUS_MIGRATION,
    "Stripe Sandbox correlation follows the current last applied-family migration",
  );

  for (const table of [
    "stripe_sandbox_checkout_sessions",
    "stripe_sandbox_webhook_events",
    "stripe_sandbox_invoices",
  ]) {
    assert(
      schema.includes(`create table public.${table} (`),
      `${table} is created`,
    );
    assert(
      schema.includes(
        `alter table public.${table} enable row level security`,
      ),
      `${table} enables RLS`,
    );
    assert(
      schema.includes(`revoke all on table public.${table} from public`) &&
        schema.includes(`revoke all on table public.${table} from anon`) &&
        schema.includes(
          `revoke all on table public.${table} from authenticated`,
        ) &&
        schema.includes(
          `revoke all on table public.${table} from service_role`,
        ) &&
        schema.includes(
          `grant select on table public.${table} to service_role`,
        ),
      `${table} is readable only by service_role`,
    );
    assert(
      !schema.includes(`grant insert on table public.${table}`) &&
        !schema.includes(`grant update on table public.${table}`) &&
        !schema.includes(`grant delete on table public.${table}`),
      `${table} has no direct write grants`,
    );
  }

  assert(
    schema.includes("user_id pg_catalog.uuid not null") &&
      schema.includes("plan_id pg_catalog.text not null") &&
      schema.includes("billing_cycle pg_catalog.text not null") &&
      schema.includes("expected_price_id pg_catalog.text not null") &&
      schema.includes("status pg_catalog.text not null default 'pending'"),
    "Checkout rows capture the authenticated user, plan, cycle, and expected price before Stripe",
  );
  assert(
    schema.includes(
      "constraint stripe_sandbox_checkout_sessions_stripe_session_id_key\n    unique (stripe_session_id)",
    ),
    "stripe_session_id is unique",
  );
  assert(
    schema.includes("event_id pg_catalog.text primary key"),
    "event_id is unique",
  );
  assert(
    schema.includes("invoice_id pg_catalog.text primary key"),
    "invoice_id is unique",
  );
  assert(
    schema.includes("create index stripe_sandbox_invoices_subscription_id_idx") &&
      !/unique index stripe_sandbox_invoices_subscription/i.test(schema),
    "a subscription may have several invoices",
  );

  assert(
    rpcs.includes("create or replace function public.stripe_sandbox_acquire_writer_lock()") &&
      rpcs.includes(
        "pg_catalog.hashtextextended('zencierge.stripe_sandbox.writer', 0)",
      ) &&
      (rpcs.match(/pg_catalog\.pg_advisory_xact_lock/g) ?? []).length === 1 &&
      !rpcs.includes("stripe_sandbox.event.") &&
      !rpcs.includes("stripe_sandbox.invoice.") &&
      !rpcs.includes("stripe_sandbox.session.") &&
      !rpcs.includes("stripe_sandbox.subscription.") &&
      !rpcs.includes("stripe_sandbox.checkout."),
    "writers share one advisory transaction lock and do not mix per-entity lock orders",
  );
  assert(
    rpcs.includes("perform public.stripe_sandbox_acquire_writer_lock();") &&
      (rpcs.match(/perform public\.stripe_sandbox_acquire_writer_lock\(\);/g) ??
        []).length === 5,
    "register, attach, apply, advance, and reprocess acquire the writer lock first",
  );
  assert(
    rpcs.includes(
      "on conflict on constraint stripe_sandbox_webhook_events_pkey do nothing",
    ) &&
      rpcs.includes(
        "on conflict on constraint stripe_sandbox_invoices_pkey do nothing",
      ) &&
      rpcs.includes("returning e.event_id into v_claimed") &&
      rpcs.includes("returning s.id, s.status") &&
      rpcs.includes("returning i.invoice_id into v_inserted") &&
      !rpcs.includes("on conflict (event_id)") &&
      !rpcs.includes("on conflict (invoice_id)") &&
      !rpcs.includes("returning event_id into") &&
      !rpcs.includes("returning id, status") &&
      !rpcs.includes("variable_conflict") &&
      rpcs.includes("for update"),
    "RETURNING and ON CONFLICT use table aliases or named PKs, not output-parameter names",
  );
  assert(
    rpcs.includes("v_event.client_reference_id is not null") &&
      rpcs.includes("v_ref is null") &&
      rpcs.includes("v_checkout.id is distinct from v_ref"),
    "a present client_reference_id must be a UUID that matches the resolved Checkout row",
  );
  assert(
    rpcs.includes("v_existing_checkout is distinct from v_checkout.id") &&
      rpcs.includes("v_existing_sub") &&
      rpcs.includes("is distinct from v_event.stripe_subscription_id then") &&
      rpcs.includes("return 'duplicate_invoice'") &&
      rpcs.includes("return 'conflict'"),
    "an existing invoice with a different checkout or subscription is conflict, not duplicate_invoice",
  );
  assert(
    /if v_existing\.status = 'awaiting_correlation' then\s+v_status := public\.stripe_sandbox_advance_claimed_event\(v_event_id\);/s.test(
      rpcs,
    ) &&
      rpcs.includes("replayed := false;") &&
      rpcs.includes("processed_at = null"),
    "same event_id/hash in awaiting_correlation retries correlation instead of replaying",
  );
  assert(
    rpcs.includes("payload_sha256 is distinct from v_hash") &&
      rpcs.includes("status := 'conflict'") &&
      rpcs.includes("replayed := true"),
    "a different hash is conflict and a completed event is replayed",
  );
  assert(
    rpcs.includes(
      "coalesce(s.stripe_session_id, v_event.stripe_session_id)",
    ) &&
      rpcs.includes(
        "coalesce(s.stripe_subscription_id, v_event.stripe_subscription_id)",
      ) &&
      rpcs.includes("is distinct from v_event.stripe_session_id") &&
      rpcs.includes("is distinct from v_event.stripe_subscription_id"),
    "linked Stripe ids are not replaced with different values",
  );
  assert(
    rpcs.includes("stripe_sandbox_reprocess_awaiting_events"),
    "awaiting events can be advanced after a later correlation",
  );
  assert(
    rpcs.includes("insert into public.stripe_sandbox_invoices") &&
      rpcs.includes("status = 'applied'") &&
      rpcs.includes("and i.webhook_event_id = v_event.event_id"),
    "applied is recorded only when the invoice row exists in the same transaction",
  );
  assert(
    rpcs.includes("set search_path = pg_catalog") &&
      rpcs.includes("security definer") &&
      rpcs.includes(
        "grant execute on function public.stripe_sandbox_apply_webhook_event(",
      ) &&
      rpcs.includes(
        "grant execute on function public.stripe_sandbox_register_checkout_session(",
      ),
    "SECURITY DEFINER RPCs use a safe search_path and service_role EXECUTE",
  );
  assert(
    rpcs.includes(
      "revoke all on function public.stripe_sandbox_advance_claimed_event(pg_catalog.text)\n  from service_role",
    ) &&
      rpcs.includes(
        "revoke all on function public.stripe_sandbox_reprocess_awaiting_events()\n  from service_role",
      ) &&
      rpcs.includes(
        "revoke all on function public.stripe_sandbox_acquire_writer_lock()\n  from service_role",
      ),
    "internal helpers are not executable by service_role",
  );

  const forbiddenDdl = [
    "alter table public.host_subscriptions",
    "alter table public.subscription_payments",
    "alter table public.subscription_webhook_events",
    "from public.host_subscriptions",
    "into public.host_subscriptions",
    "from public.subscription_payments",
    "into public.subscription_payments",
    "public.square_billing_",
    "public.process_subscription_webhook_atomic",
    "public.square_subscription_intents",
  ];
  for (const token of forbiddenDdl) {
    assert(
      !schema.includes(token) && !rpcs.includes(token),
      `does not touch ${token}`,
    );
  }

  const source = readFileSync(join(migrationsDir, EXPECTED_MIGRATION), "utf8");
  const digest = createHash("sha256")
    .update(normalizeLineEndings(source), "utf8")
    .digest("hex");
  assert(digest.length === 64, "migration SHA-256 is computed");

  console.log(
    "Stripe Sandbox billing correlation schema tests passed (static SQL only; no local PostgreSQL run)",
  );
}

runStripeSandboxBillingCorrelationSchemaTests();
