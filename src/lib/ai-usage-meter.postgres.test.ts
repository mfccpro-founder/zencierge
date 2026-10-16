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

function psqlBin() {
  return process.env.AI_USAGE_METER_PSQL?.trim() || "psql";
}

function databaseUrl() {
  const url = process.env.AI_USAGE_METER_TEST_DATABASE_URL?.trim() || "";
  if (!url) throw new Error("postgres concurrency test not run: AI_USAGE_METER_TEST_DATABASE_URL is unset");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("postgres concurrency test not run: AI_USAGE_METER_TEST_DATABASE_URL is not a URL");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`postgres concurrency test not run: refusing database host ${host}`);
  }
  return url;
}

function runPsql(sql: string, database = databaseUrl()) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(psqlBin(), [database, "-v", "ON_ERROR_STOP=1", "-q"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `psql exited ${code}`));
        return;
      }
      resolve(`${stdout}\n${stderr}`);
    });
    child.stdin.end(sql);
  });
}

function runPsqlArgs(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(psqlBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function prepareDatabase() {
  await runPsql(`
    do $roles$
    begin
      if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
      if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end
    $roles$;
    alter role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  const migration = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260928153000_ai_usage_tts_meter_foundation.sql"),
    "utf8",
  );
  await runPsql(migration);
  const sequential = readFileSync(join(process.cwd(), "src", "lib", "ai-usage-meter.postgres.sql"), "utf8");
  const sequentialOutput = await runPsql(sequential);
  assert(
    sequentialOutput.includes("ai-usage meter postgres sequential tests passed"),
    "sequential postgres tests did not report success",
  );
}

const CONCURRENCY_HOLD_SECONDS = 5;
const LEASE_RACE_HOLD_SECONDS = 6;
const LEASE_RACE_SECONDS = 3;
const CONCURRENCY_HEAD_START_MS = 800;
const CONCURRENCY_MIN_BLOCK_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectPsql(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function psqlScalar(sql: string) {
  const result = await runPsqlArgs([
    databaseUrl(),
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-t",
    "-A",
    "-c",
    sql,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "psql query failed");
  }
  return result.stdout.trim();
}

async function waitForLockOverlap() {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const snap = await runPsqlArgs([
      databaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-t",
      "-A",
      "-c",
      `select blocked.pid::text || '|' || blocking.pid::text
       from pg_catalog.pg_stat_activity as blocked
       join pg_catalog.pg_locks as bl on bl.pid = blocked.pid and not bl.granted
       join pg_catalog.pg_locks as gl
         on gl.locktype = bl.locktype
        and gl.database is not distinct from bl.database
        and gl.relation is not distinct from bl.relation
        and gl.page is not distinct from bl.page
        and gl.tuple is not distinct from bl.tuple
        and gl.virtualxid is not distinct from bl.virtualxid
        and gl.transactionid is not distinct from bl.transactionid
        and gl.classid is not distinct from bl.classid
        and gl.objid is not distinct from bl.objid
        and gl.objsubid is not distinct from bl.objsubid
        and gl.pid <> bl.pid
        and gl.granted
       join pg_catalog.pg_stat_activity as blocking on blocking.pid = gl.pid
       where blocked.wait_event_type = 'Lock'
       limit 1`,
    ]);
    const line = snap.stdout.trim().split(/\s+/)[0] ?? "";
    const [blockedPid, blockingPid] = line.split("|");
    if (snap.code === 0 && blockedPid && blockingPid && blockedPid !== blockingPid) return line;
    await sleep(100);
  }
  return "";
}

async function twoSessions(holderSql: string, contenderSql: string) {
  const url = databaseUrl();
  const holder = spawn(psqlBin(), [url, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const holderDone = collectPsql(holder);
  holder.stdin?.end(holderSql);
  await sleep(CONCURRENCY_HEAD_START_MS);
  const contenderStarted = Date.now();
  const contender = spawn(psqlBin(), [url, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const contenderDone = collectPsql(contender);
  contender.stdin?.end(contenderSql);
  const overlap = await waitForLockOverlap();
  const [held, waiting] = await Promise.all([holderDone, contenderDone]);
  return { waitedMs: Date.now() - contenderStarted, overlap, held, waiting };
}

async function concurrencyAcquire() {
  const issued = await runPsql(`
    select result_client_usage_key
    from public.issue_ai_usage_logical_request(
      'stay:concurrency', 'guest_stay_tts', 'tts', repeat('c', 64),
      null, 'property-concurrency', 'reservation-concurrency',
      pg_catalog.clock_timestamp() + interval '1 day', 'issued'
    );
  `);
  const key = issued
    .split(/\s+/)
    .map((part) => part.trim())
    .find((part) => /^[0-9a-f-]{36}$/i.test(part));
  assert(Boolean(key), "concurrency setup did not return a key");
  const url = databaseUrl();
  const hash = "c".repeat(64);
  const race = await twoSessions(
    `
    begin;
    select result_outcome
    from public.acquire_ai_usage_logical_request(
      '${key}', 'stay:concurrency', 'guest_stay_tts', 'tts', '${hash}', 30, false
    );
    select pg_catalog.pg_sleep(${CONCURRENCY_HOLD_SECONDS});
    commit;
  `,
    `
    set statement_timeout = '15s';
    select result_outcome || '|' || coalesce(result_acquisition_token::text, '')
    from public.acquire_ai_usage_logical_request(
      '${key}', 'stay:concurrency', 'guest_stay_tts', 'tts', '${hash}', 30, false
    );
  `,
  );
  assert(race.held.code === 0 && race.held.stdout.includes("acquired"), `holder did not acquire: ${race.held.stderr || race.held.stdout}`);
  assert(race.waiting.code === 0, `contender failed: ${race.waiting.stderr}`);
  const outcome = race.waiting.stdout.trim().split("|");
  assert(outcome[0] === "busy", `contender outcome was ${race.waiting.stdout.trim()}`);
  assert(outcome[1] === "", "contender received an acquisition token");
  assert(race.overlap.includes("|"), `same-key sessions did not overlap: waited ${race.waitedMs}ms`);
  assert(
    race.waitedMs >= CONCURRENCY_MIN_BLOCK_MS,
    `contender returned in ${race.waitedMs}ms, so the two acquires did not overlap`,
  );
  const attempts = await runPsqlArgs([
    url,
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-t",
    "-A",
    "-c",
    `select count(*)::text || '|' || min(attempt_ordinal)::text || '|' || min(dispatch_progress) || '|' || min(result_state) from public.ai_usage_attempts where logical_request_id = (select id from public.ai_usage_logical_requests where client_usage_key = '${key}')`,
  ]);
  assert(
    attempts.code === 0 && attempts.stdout.trim() === "1|1|reserved|open",
    `concurrency did not leave one reserved ordinal: ${attempts.stderr || attempts.stdout}`,
  );
  console.log(
    `same key: holder=acquired contender=busy token=empty attempts=${attempts.stdout.trim()} waitedMs=${race.waitedMs} overlapPids=${race.overlap}`,
  );
}

async function issuedAttempt(subject: string, hash: string) {
  const key = await psqlScalar(`
    select result_client_usage_key
    from public.issue_ai_usage_logical_request(
      '${subject}', 'guest_stay_tts', 'tts', '${hash}',
      null, 'property-${subject}', 'reservation-${subject}',
      pg_catalog.clock_timestamp() + interval '1 day', 'issued'
    )
  `);
  const acquired = await psqlScalar(`
    select result_logical_request_id::text || '|' || result_attempt_id::text || '|' || result_acquisition_token::text
    from public.acquire_ai_usage_logical_request(
      '${key}', '${subject}', 'guest_stay_tts', 'tts', '${hash}', 30, false
    )
  `);
  const [requestId, attemptId, token, extra] = acquired.split("|");
  assert(Boolean(requestId && attemptId && token && extra === undefined), `acquire setup failed: ${acquired}`);
  return { requestId, attemptId, token };
}

function holderKeepsLock(requestId: string) {
  return `
    begin;
    select to_char(pg_catalog.clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS')
    from public.ai_usage_logical_requests
    where id = '${requestId}'
    for update;
    select pg_catalog.pg_sleep(${LEASE_RACE_HOLD_SECONDS});
    select to_char(pg_catalog.clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS');
    commit;
  `;
}

async function concurrencyFallback() {
  const hash = "d".repeat(64);
  const { requestId, attemptId, token } = await issuedAttempt("stay:concurrency-fallback", hash);
  const dispatched = await psqlScalar(`select result_updated::text from public.mark_ai_usage_dispatch_started('${attemptId}', '${token}')`);
  assert(isTrue(dispatched), `fallback setup did not dispatch: ${dispatched}`);
  assert(isTrue(await psqlScalar(`select result_updated::text from public.mark_ai_usage_response_observed('${attemptId}', '${token}')`)), "fallback setup did not observe");
  assert(
    isTrue(await psqlScalar(`select result_recorded::text from public.record_ai_usage_attempt_result('${attemptId}', '${token}', 'failed', null, 'pending', 'openai', 'gpt-4o-mini-tts', 12, null, false)`)),
    "fallback setup did not close the current attempt",
  );
  const before = await psqlScalar(`
    select count(*)::text || '|' || min(a.attempt_ordinal)::text || '|' || r.next_attempt_ordinal::text
    from public.ai_usage_logical_requests as r
    join public.ai_usage_attempts as a on a.logical_request_id = r.id
    where r.id = '${requestId}'
    group by r.next_attempt_ordinal
  `);
  const leaseExpires = await psqlScalar(`
    update public.ai_usage_logical_requests
    set lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => ${LEASE_RACE_SECONDS})
    where id = '${requestId}'
    returning to_char(lease_expires_at, 'YYYY-MM-DD HH24:MI:SS.MS')
  `);
  const race = await twoSessions(
    holderKeepsLock(requestId),
    `
    set statement_timeout = '20s';
    select to_char(pg_catalog.clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS');
    select result_started::text || '|' || coalesce(result_attempt_id::text, '') || '|' || coalesce(result_attempt_ordinal::text, '')
    from public.begin_ai_usage_fallback_attempt('${requestId}', '${token}');
  `,
  );
  assert(race.held.code === 0, `fallback holder failed: ${race.held.stderr || race.held.stdout}`);
  assert(race.waiting.code === 0, `fallback contender failed: ${race.waiting.stderr || race.waiting.stdout}`);
  const lines = race.waiting.stdout.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
  const entered = lines[0] ?? "";
  const outcome = (lines[1] ?? "").split("|");
  const enteredWhileLive = await psqlScalar(`select (timestamptz '${entered}' < timestamptz '${leaseExpires}')::text`);
  const after = await psqlScalar(`
    select count(*)::text || '|' || min(a.attempt_ordinal)::text || '|' || r.next_attempt_ordinal::text
    from public.ai_usage_logical_requests as r
    join public.ai_usage_attempts as a on a.logical_request_id = r.id
    where r.id = '${requestId}'
    group by r.next_attempt_ordinal
  `);
  assert(race.overlap.includes("|"), `fallback sessions did not overlap: waited ${race.waitedMs}ms`);
  assert(race.waitedMs >= CONCURRENCY_MIN_BLOCK_MS, `fallback returned in ${race.waitedMs}ms, so it did not wait for the lock`);
  assert(isTrue(enteredWhileLive), `fallback started after the lease had already expired: entered ${entered} lease ${leaseExpires}`);
  assert(isFalse(outcome[0] ?? "") && outcome[1] === "", `fallback outcome was ${lines[1] ?? ""}`);
  assert(before === "1|1|1" && after === before, `fallback created an attempt: before ${before} after ${after}`);
  console.log(
    `fallback: started=${outcome[0]} newAttempt=${outcome[1] || "none"} attempts=${after} entered=${entered} leaseExpires=${leaseExpires} waitedMs=${race.waitedMs} overlapPids=${race.overlap}`,
  );
}

async function concurrencyRenew() {
  const hash = "e".repeat(64);
  const { requestId, token } = await issuedAttempt("stay:concurrency-renew", hash);
  const leaseExpires = await psqlScalar(`
    update public.ai_usage_logical_requests
    set lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => ${LEASE_RACE_SECONDS})
    where id = '${requestId}'
    returning to_char(lease_expires_at, 'YYYY-MM-DD HH24:MI:SS.MS')
  `);
  const race = await twoSessions(
    holderKeepsLock(requestId),
    `
    set statement_timeout = '20s';
    select to_char(pg_catalog.clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS');
    select result_renewed::text || '|' || coalesce(to_char(result_lease_expires_at, 'YYYY-MM-DD HH24:MI:SS.MS'), '')
    from public.renew_ai_usage_lease('${requestId}', '${token}', 30);
  `,
  );
  assert(race.held.code === 0, `renew holder failed: ${race.held.stderr || race.held.stdout}`);
  assert(race.waiting.code === 0, `renew contender failed: ${race.waiting.stderr || race.waiting.stdout}`);
  const lines = race.waiting.stdout.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
  const entered = lines[0] ?? "";
  const outcome = (lines[1] ?? "").split("|");
  const enteredWhileLive = await psqlScalar(`select (timestamptz '${entered}' < timestamptz '${leaseExpires}')::text`);
  const stored = await psqlScalar(`
    select (to_char(lease_expires_at, 'YYYY-MM-DD HH24:MI:SS.MS') = '${leaseExpires}')::text
      || '|' || (lease_expires_at <= pg_catalog.clock_timestamp())::text
    from public.ai_usage_logical_requests
    where id = '${requestId}'
  `);
  assert(race.overlap.includes("|"), `renew sessions did not overlap: waited ${race.waitedMs}ms`);
  assert(race.waitedMs >= CONCURRENCY_MIN_BLOCK_MS, `renew returned in ${race.waitedMs}ms, so it did not wait for the lock`);
  const [storedSame, storedExpired] = stored.split("|");
  assert(isTrue(enteredWhileLive), `renew started after the lease had already expired: entered ${entered} lease ${leaseExpires}`);
  assert(isFalse(outcome[0] ?? "") && outcome[1] === "", `renew outcome was ${lines[1] ?? ""}`);
  assert(isTrue(storedSame ?? "") && isTrue(storedExpired ?? ""), `renew changed the stored lease: ${stored} expected the original ${leaseExpires}`);
  console.log(
    `renew: renewed=${outcome[0]} newLease=${outcome[1] || "none"} storedUnchangedAndExpired=${stored} entered=${entered} leaseExpires=${leaseExpires} waitedMs=${race.waitedMs} overlapPids=${race.overlap}`,
  );
}

async function runPostgresAiUsageMeterTests() {
  await prepareDatabase();
  console.log("ai-usage meter postgres sequential tests passed");
  await concurrencyAcquire();
  await concurrencyFallback();
  await concurrencyRenew();
  console.log("ai-usage meter postgres concurrency tests passed");
}

const isDirectRun = process.argv[1]?.includes("ai-usage-meter.postgres.test");
if (isDirectRun) {
  runPostgresAiUsageMeterTests().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "ai-usage meter postgres tests failed";
    if (message.includes("ENOENT") || message.includes("not run")) {
      console.error(`postgres concurrency test not run: ${message}`);
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  });
}
