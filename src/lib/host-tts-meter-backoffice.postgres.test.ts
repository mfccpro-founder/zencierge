import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function isTrue(value: string) {
  return value === "t" || value === "true";
}

function isFalse(value: string) {
  return value === "f" || value === "false";
}

function databaseUrl() {
  const url = process.env.AI_USAGE_METER_TEST_DATABASE_URL?.trim() || "";
  if (!url) throw new Error("host tts backoffice postgres test not run: AI_USAGE_METER_TEST_DATABASE_URL is unset");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("host tts backoffice postgres test not run: AI_USAGE_METER_TEST_DATABASE_URL is not a URL");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`host tts backoffice postgres test not run: refusing database host ${host}`);
  }
  return url;
}

function psqlBin() {
  return process.env.AI_USAGE_METER_PSQL?.trim() || "psql";
}

function runPsql(sql: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(psqlBin(), [databaseUrl(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err.trim() || out.trim() || `psql exited ${code}`));
      else resolve(out.trim());
    });
    child.stdin.end(sql);
  });
}

function summaryQuery(from: string, to: string) {
  return `
    select
      logical_requests::text || '|' ||
      completed_requests::text || '|' ||
      failed_requests::text || '|' ||
      observed_attempts::text || '|' ||
      characters::text || '|' ||
      pending_cost_attempts::text || '|' ||
      pending_characters::text || '|' ||
      coalesce(estimated_cost_cents::text, 'null') || '|' ||
      totals_partial::text
    from public.summarize_host_tts_meter_backoffice('${from}', '${to}');
  `;
}

async function runBackofficePostgresTests() {
  const root = process.cwd();
  await runPsql(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
  `);
  await runPsql(readFileSync(join(root, "supabase/migrations/20260928153000_ai_usage_tts_meter_foundation.sql"), "utf8"));
  await runPsql(readFileSync(join(root, "supabase/migrations/20260928200000_host_tts_meter_backoffice_read.sql"), "utf8"));

  await runPsql(`
    delete from public.ai_usage_attempts
    where logical_request_id in (
      select id from public.ai_usage_logical_requests
      where client_usage_key in ('host-backoffice-jan', 'host-backoffice-reserved', 'host-backoffice-uncertain')
    );
    delete from public.ai_usage_logical_requests
    where client_usage_key in ('host-backoffice-jan', 'host-backoffice-reserved', 'host-backoffice-uncertain');

    insert into public.ai_usage_logical_requests (
      client_usage_key, billing_subject, source, operation, synthesis_binding_hash,
      state, billing_eligibility, key_origin, expires_at, next_attempt_ordinal, created_at
    ) values
      ('host-backoffice-jan', 'host:backoffice', 'host_tts', 'tts', repeat('a', 64),
       'completed', 'withheld', 'issued', '2026-03-01 00:00:00+00', 2, '2026-01-15 12:00:00+00'),
      ('host-backoffice-reserved', 'host:backoffice', 'host_tts', 'tts', repeat('b', 64),
       'issued', 'withheld', 'issued', '2026-04-01 00:00:00+00', 1, '2026-03-10 12:00:00+00'),
      ('host-backoffice-uncertain', 'host:backoffice', 'host_tts', 'tts', repeat('c', 64),
       'uncertain', 'withheld', 'issued', '2026-05-01 00:00:00+00', 1, '2026-04-10 12:00:00+00');

    insert into public.ai_usage_attempts (
      logical_request_id, attempt_ordinal, created_at, dispatch_progress, result_state,
      response_observed_at, cost_class, calculated_cost_cents, input_characters, stream_completed
    )
    select id, 1, '2026-01-20 12:00:00+00', 'response_observed', 'provider_complete',
           '2026-01-20 12:05:00+00', 'estimated', 30, 11, true
    from public.ai_usage_logical_requests where client_usage_key = 'host-backoffice-jan';

    insert into public.ai_usage_attempts (
      logical_request_id, attempt_ordinal, created_at, dispatch_progress, result_state,
      response_observed_at, cost_class, calculated_cost_cents, input_characters, stream_completed
    )
    select id, 2, '2026-02-10 12:00:00+00', 'response_observed', 'provider_complete',
           '2026-02-10 12:05:00+00', 'estimated', 40, 22, true
    from public.ai_usage_logical_requests where client_usage_key = 'host-backoffice-jan';

    insert into public.ai_usage_attempts (
      logical_request_id, attempt_ordinal, created_at, dispatch_progress, result_state, input_characters
    )
    select id, 1, '2026-03-10 12:00:00+00', 'reserved', 'open', 99
    from public.ai_usage_logical_requests where client_usage_key = 'host-backoffice-reserved';

    insert into public.ai_usage_attempts (
      logical_request_id, attempt_ordinal, created_at, dispatch_progress, result_state,
      response_observed_at, cost_class, input_characters
    )
    select id, 1, '2026-04-10 12:00:00+00', 'response_observed', 'uncertain',
           '2026-04-10 12:05:00+00', 'pending', 7
    from public.ai_usage_logical_requests where client_usage_key = 'host-backoffice-uncertain';
  `);

  const january = await runPsql(summaryQuery("2026-01-01 00:00:00+00", "2026-02-01 00:00:00+00"));
  const february = await runPsql(summaryQuery("2026-02-01 00:00:00+00", "2026-03-01 00:00:00+00"));
  const march = await runPsql(summaryQuery("2026-03-01 00:00:00+00", "2026-04-01 00:00:00+00"));
  const april = await runPsql(summaryQuery("2026-04-01 00:00:00+00", "2026-05-01 00:00:00+00"));

  assert(january === "1|1|0|1|11|0|0|30|false", `january summary ${january}`);
  assert(february === "0|0|0|1|22|0|0|40|false", `february summary ${february}`);
  assert(march === "1|0|0|0|0|0|0|null|false", `reserved summary ${march}`);
  assert(april === "1|0|0|1|0|1|7|null|true", `uncertain observed summary ${april}`);
  assert(isFalse(march.split("|")[8] ?? ""), "a reserved attempt does not make the total partial");
  assert(isTrue(april.split("|")[8] ?? ""), "an uncertain observed attempt keeps the total partial");
}

const isDirectRun = process.argv[1]?.includes("host-tts-meter-backoffice.postgres.test");
if (isDirectRun) {
  runBackofficePostgresTests()
    .then(() => {
      console.log("host tts backoffice postgres tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "host tts backoffice postgres tests failed");
      process.exitCode = 1;
    });
}
