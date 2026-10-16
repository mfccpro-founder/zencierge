import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_USAGE_AUDIO_STORAGE_PROTOCOL,
  AI_USAGE_METER_RPC,
  acquireAiUsageLogicalRequest,
  issueAiUsageLogicalRequest,
  type AiUsageMeterRpcClient,
} from "./ai-usage-meter";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const MIGRATION = "20260928153000_ai_usage_tts_meter_foundation.sql";

function executableSql(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase();
}

function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`function public.${name}`);
  assert(start >= 0, `${name} exists`);
  const next = sql.indexOf("\ncreate or replace function ", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

function runStaticAiUsageMeterTests() {
  const root = process.cwd();
  const sql = readFileSync(join(root, "supabase", "migrations", MIGRATION), "utf8").replace(/\r\n/g, "\n");
  const body = executableSql(sql);
  assert(!sql.includes("*/"), "migration comments are line comments");
  assert(!body.includes("alter table public.ai_usage_events"), "historical usage rows are not altered");
  assert(!body.includes("update public.ai_usage_events"), "historical usage rows are not updated");
  assert(!body.includes("delete from public.ai_usage_events"), "historical usage rows are not deleted");
  assert(!body.includes("from public.ai_usage_events"), "the meter summary does not read historical rows");
  assert(body.includes("ai_usage_logical_requests_candidate_requires_host_and_property"), "candidate requires host and property");
  assert(body.includes("source in ('guest_stay_tts', 'guest_stay_welcome_tts')"), "candidate sources are guest stay and welcome");
  assert(sql.includes("technical gate for this block, not a final commercial policy"), "host_tts withhold is a technical gate");
  assert(body.includes("for update"), "acquisition locks the logical request");
  assert(body.includes("response_observed_at = coalesce(a.response_observed_at"), "observation is kept once recorded");
  assert(!body.includes("response_observed_at = null"), "uncertain does not clear observation");
  assert(sql.includes("Counts logical requests by logical request created_at."), "requests use the logical request timestamp");
  assert(sql.includes("Counts attempts by attempt created_at."), "attempts use the attempt timestamp");
  assert(sql.includes("Does not count distinct logical_request_id from attempts."), "requests are not a distinct of attempts");
  assert(sql.includes("Postgres and Supabase Storage do not share a transaction."), "storage transaction boundary is documented");
  assert(sql.includes("does not assume storage lifecycle expiry"), "cleanup does not assume bucket expiry");
  assert(sql.includes("stale acquisition token cannot replace a committed audio object"), "stale token cannot replace audio");
  assert(body.includes("revoke all on table public.ai_usage_logical_requests from service_role"), "service_role has no table privilege");
  assert(!body.includes("grant select") && !body.includes("grant insert") && !body.includes("grant update") && !body.includes("grant delete"), "tables are not granted");
  assert(
    !/\bto authenticated\b/.test(body) && !/\bto anon\b/.test(body) && !/\bto public\b/.test(body),
    "execute is not granted to host roles",
  );
  assert(body.includes("grant execute on function public.acquire_ai_usage_logical_request"), "service_role can execute acquire");
  assert(!functionBody(sql, "record_ai_usage_audio_delivery_failure").includes("calculated_cost_cents"), "audio delivery failure does not rewrite cost");
  assert(functionBody(sql, "lookup_ai_usage_replay_audio").includes("r.expires_at"), "replay checks the request expiry");
  assert(functionBody(sql, "record_ai_usage_attempt_result").includes("p_stream_completed is not true"), "complete audio is required before provider_complete");
  assert(functionBody(sql, "close_ai_usage_logical_request").includes("a.stream_completed is true"), "close requires a complete stream");
  assert(functionBody(sql, "close_ai_usage_logical_request").includes("a.audio_bytes = o.byte_length"), "close checks the stored size");
  assert(functionBody(sql, "commit_ai_usage_attempt_audio").includes("o.attempt_id = p_attempt_id"), "commit requires the same attempt");
  assert(functionBody(sql, "commit_ai_usage_attempt_audio").includes("o.acquisition_token = p_acquisition_token"), "commit requires the same token");
  assert(sql.includes("The sequential test does not prove concurrent races."), "sequential coverage does not claim race safety");
  const summary = functionBody(sql, "summarize_ai_usage_tts_meter");
  assert(
    summary.includes("a.result_state = 'open'") && summary.includes("a.dispatch_progress in ('dispatch_started', 'response_observed')"),
    "open dispatched attempts keep totals partial",
  );
  for (const name of [
    "mark_ai_usage_dispatch_started",
    "mark_ai_usage_response_observed",
    "record_ai_usage_attempt_result",
    "record_ai_usage_audio_delivery_failure",
    "renew_ai_usage_lease",
    "begin_ai_usage_fallback_attempt",
    "commit_ai_usage_attempt_audio",
    "close_ai_usage_logical_request",
    "expire_ai_usage_leases",
  ]) {
    const fn = functionBody(sql, name);
    const requestFrom = fn.indexOf("from public.ai_usage_logical_requests");
    const requestLock = fn.indexOf("for update", requestFrom);
    assert(requestFrom >= 0 && requestLock > requestFrom, `${name} locks the logical request`);
    const attemptWrite = fn.search(/update public\.ai_usage_attempts|for update of a/);
    if (attemptWrite >= 0) {
      assert(requestLock < attemptWrite, `${name} locks the request before the attempt`);
    }
  }
  const renew = functionBody(sql, "renew_ai_usage_lease");
  const renewLock = renew.indexOf("for update");
  assert(renewLock >= 0 && renewLock < renew.indexOf("make_interval"), "renew calculates the new lease after the lock");
  assert(renew.indexOf("v_current_lease <= pg_catalog.clock_timestamp()") > renewLock, "renew rechecks the live lease after the lock");
  const fallback = functionBody(sql, "begin_ai_usage_fallback_attempt");
  const fallbackLock = fallback.indexOf("for update");
  const fallbackWhere = fallback.slice(fallback.indexOf("where r.id = p_logical_request_id"), fallbackLock);
  assert(!fallbackWhere.includes("lease_expires_at"), "fallback does not decide the lease inside the locking predicate");
  assert(fallback.indexOf("v_lease <= pg_catalog.clock_timestamp()", fallbackLock) > fallbackLock, "fallback rechecks the lease after the lock");
  const commit = functionBody(sql, "commit_ai_usage_attempt_audio");
  assert(
    commit.indexOf("for update") < commit.indexOf("insert into public.ai_usage_audio_objects"),
    "commit checks the lease before writing an audio object",
  );

  for (const relative of [
    "src/app/api/guest/stay-tts/route.ts",
    "src/app/api/guest/stay-welcome-tts/route.ts",
    "src/lib/guest-stay-tts.ts",
    "src/lib/guest-stay-welcome.ts",
    "src/lib/tts-synthesize.ts",
    "src/app/(founder-admin)/backoffice/isabela-usage/page.tsx",
  ]) {
    const source = readFileSync(join(root, relative), "utf8");
    assert(!source.includes("ai-usage-meter"), `${relative} is not connected to the meter`);
    assert(!source.includes("ai-usage-audio"), `${relative} is not connected to audio storage`);
    assert(!source.includes("issue_ai_usage_logical_request"), `${relative} does not issue meter keys`);
  }
  const hostRoute = readFileSync(join(root, "src/app/api/tts/route.ts"), "utf8");
  const usageRead = readFileSync(join(root, "src/lib/ai-usage.ts"), "utf8");
  assert(hostRoute.includes("if (!hostTtsMeterEnabled())"), "host TTS meter is behind the server flag");
  assert(hostRoute.includes('source: "host_tts"'), "unmetered host TTS still records events");
  assert(!usageRead.includes("issue_ai_usage_logical_request"), "Back Office does not issue meter keys");
  assert(usageRead.includes("summarize_host_tts_meter_backoffice"), "Back Office can read host meter totals");
  assert(!usageRead.includes("hostTtsMeterEnabled("), "historical meter reads ignore the write flag");

  assert(AI_USAGE_AUDIO_STORAGE_PROTOCOL.includes("do not share a transaction"), "client protocol names the storage boundary");
  const calls: Array<{ fn: string; args: Record<string, string | number | boolean | null> }> = [];
  const admin: AiUsageMeterRpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve({ data: [{ result_outcome: "acquired" }], error: null });
    },
  };
  return Promise.all([
    issueAiUsageLogicalRequest(admin, {
      billingSubject: "stay:1",
      source: "guest_stay_tts",
      synthesisBindingHash: "a".repeat(64),
      hostId: null,
      propertyId: null,
      reservationId: "stay-1",
      expiresAt: "2026-10-01T00:00:00.000Z",
    }).then((issued) => {
      assert(issued.error === null, "issue wrapper returns the rpc row");
      assert(calls[0]?.fn === AI_USAGE_METER_RPC.issue, "issue uses the meter function");
      assert(calls[0]?.args.p_synthesis_binding_hash === "a".repeat(64), "issue sends the binding hash");
      assert(calls[0]?.args.p_key_origin === "issued", "issue defaults to an issued key");
    }),
    acquireAiUsageLogicalRequest(admin, {
      clientUsageKey: "key-1",
      billingSubject: "stay:1",
      source: "guest_stay_tts",
      synthesisBindingHash: "a".repeat(64),
    }).then((acquired) => {
      assert(acquired.row?.result_outcome === "acquired", "acquire wrapper reads the outcome");
      assert(calls[1]?.args.p_allow_retry === false, "acquire does not retry unless asked");
    }),
  ]);
}

const isDirectRun = process.argv[1]?.includes("ai-usage-meter.test");
if (isDirectRun) {
  runStaticAiUsageMeterTests()
    .then(() => {
      console.log("ai-usage meter static tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "ai-usage meter static tests failed");
      process.exitCode = 1;
    });
}
