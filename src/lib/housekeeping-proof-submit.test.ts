import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOUSEKEEPING_PROOF_SUBMIT_PATH,
  HOUSEKEEPING_PROOF_SUBMIT_RATE_MAX,
  HOUSEKEEPING_PROOF_SUBMIT_RPC,
  HOUSEKEEPING_PROOF_SUBMIT_SUCCESS_KEYS,
  createMemoryHousekeepingProofSubmitStore,
  handleHousekeepingProofSubmit,
  housekeepingProofSubmitHashRateKey,
  housekeepingProofSubmitIpRateKey,
  mapHousekeepingProofSubmitRpcCode,
} from "./housekeeping-proof-submit";
import { generateHousekeepingProofToken, hashHousekeepingProofToken } from "./housekeeping-proof";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

export function runHousekeepingProofSubmitRpcContractTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..");
  const migrationsDir = join(root, "supabase", "migrations");
  const reviewPath = join(migrationsDir, "20260904050400_housekeeping_proof_review_rpc.sql");
  const submitPath = join(migrationsDir, "20260904184500_housekeeping_proof_submit_rpc.sql");
  const reviewBytes = readFileSync(reviewPath);
  const reviewHash = createHash("sha256").update(reviewBytes).digest("hex");
  assert(reviewHash.length === 64, "prior review migration hash computed");
  assert(reviewBytes.includes("review_housekeeping_proof_batch_atomic"), "prior review RPC migration remains present");
  assert(!reviewBytes.toString("utf8").includes("submit_housekeeping_proof_atomic"), "prior review migration has no submit RPC");

  const sql = readFileSync(submitPath, "utf8");
  assert(sql.includes("create or replace function public.submit_housekeeping_proof_atomic"), "submit RPC name");
  assert(/\bsecurity definer\b/i.test(sql), "submit is SECURITY DEFINER");
  assert(/set search_path = pg_catalog\b/i.test(sql), "safe fixed search_path");
  assert(sql.includes("p_token_hash text"), "token hash input only");
  assert(sql.includes("returns table (") && sql.includes("status text") && sql.includes("idempotent boolean"), "return status + idempotent");
  assert(!/returns table\([^)]*token/i.test(sql), "return row has no token fields");
  assert(!/\btask_id\b/.test(sql.slice(sql.indexOf("returns table"), sql.indexOf("language plpgsql"))), "return has no task_id");

  const submitFn = sql.slice(
    sql.toLowerCase().indexOf("create or replace function public.submit_housekeeping_proof_atomic"),
    sql.toLowerCase().indexOf("create or replace function public.review_housekeeping_proof_batch_atomic"),
  );
  const submitBody = submitFn.slice(submitFn.toLowerCase().indexOf("as $$"), submitFn.toLowerCase().lastIndexOf("$$"));

  const lookupTokenAt = submitBody.toLowerCase().indexOf("from public.housekeeping_proof_tokens tok");
  const taskForUpdateAt = submitBody.toLowerCase().indexOf("from public.housekeeping_proof_tasks t");
  const authTokenForUpdateAt = submitBody.toLowerCase().lastIndexOf("from public.housekeeping_proof_tokens tok");
  assert(lookupTokenAt >= 0 && taskForUpdateAt >= 0 && authTokenForUpdateAt >= 0, "token lookup, task lock, and token revalidation present");
  assert(lookupTokenAt < taskForUpdateAt, "initial token lookup resolves task before task lock");
  assert(taskForUpdateAt < authTokenForUpdateAt, "task FOR UPDATE occurs before authoritative token lock");
  const taskLockSlice = submitBody.slice(taskForUpdateAt, authTokenForUpdateAt);
  assert(/\bfor update\b/i.test(taskLockSlice), "task row is locked with FOR UPDATE");
  const authTokenSlice = submitBody.slice(authTokenForUpdateAt);
  assert(/\bfor update\b/i.test(authTokenSlice), "authoritative token query uses FOR UPDATE");
  assert(!/\bfor update\b/i.test(submitBody.slice(lookupTokenAt, taskForUpdateAt)), "initial token lookup is not locked");

  const statusBranchAt = submitBody.indexOf("if v_task_status = 'submitted'");
  assert(statusBranchAt > authTokenForUpdateAt, "status/idempotency evaluated after token revalidation");
  assert(submitBody.includes("v_token_task_id is distinct from v_task_id"), "token must still belong to locked task");
  const postLockSlice = submitBody.slice(authTokenForUpdateAt);
  assert(postLockSlice.includes("ERRCODE = 'ZP005'") && postLockSlice.includes("MESSAGE = 'revoked'"), "revocation checked after locking");
  assert(postLockSlice.includes("ERRCODE = 'ZP004'") && postLockSlice.includes("MESSAGE = 'expired'"), "expiration checked after locking");

  assert(submitBody.includes("review_status = 'pending'"), "counts only pending photos");
  assert(submitBody.includes("v_task_status = 'submitted'"), "idempotent submitted path");
  assert(submitBody.includes("submitted_at = v_now"), "sets submitted_at on real transition");
  assert(submitBody.includes("'open'") && submitBody.includes("'needs_attention'"), "real transitions from open or needs_attention");
  assert(submitBody.includes("'approved'") && submitBody.includes("'closed'"), "approved/closed conflict");
  assert(submitBody.includes("^[0-9a-f]{64}$") || submitBody.includes("'^[0-9a-f]{64}$'"), "hash format checked");
  assert(!/\bp_token\b/.test(submitBody) && !/\bplaintext\b/i.test(submitBody), "no plaintext token");
  assert(!/\braise (log|notice|info|warning|debug)\b/i.test(submitBody), "no logging");
  assert(!/\bexecute\b/i.test(submitBody), "no dynamic SQL");

  assert(sql.includes("revoke all on function public.submit_housekeeping_proof_atomic(text) from public"), "submit revoked from public");
  assert(sql.includes("from anon") && sql.includes("from authenticated"), "anon/authenticated revoked");
  assert(
    sql.includes("grant execute on function public.submit_housekeeping_proof_atomic(text) to service_role"),
    "submit execute is service_role only",
  );

  const reviewFn = sql.slice(sql.toLowerCase().indexOf("create or replace function public.review_housekeeping_proof_batch_atomic"));
  assert(reviewFn.includes("v_task_status is distinct from 'submitted'"), "review requires submitted for real decisions");
  assert(!reviewFn.includes("v_task_status is distinct from 'open'"), "open is no longer an allowed real-review status");
  assert(reviewFn.includes("for update"), "review still locks task");
  assert(
    sql.includes(
      "grant execute on function public.review_housekeeping_proof_batch_atomic(text, text, text, text, uuid) to service_role",
    ),
    "review execute remains service_role only",
  );
}

export async function runHousekeepingProofSubmitTests() {
  runHousekeepingProofSubmitRpcContractTests();

  assert(HOUSEKEEPING_PROOF_SUBMIT_RPC === "submit_housekeeping_proof_atomic", "rpc name");
  assert(HOUSEKEEPING_PROOF_SUBMIT_PATH === "/api/housekeeping/proof/submit", "submit path");
  assert(HOUSEKEEPING_PROOF_SUBMIT_RATE_MAX === 20, "submit rate max");
  assert(
    [...HOUSEKEEPING_PROOF_SUBMIT_SUCCESS_KEYS].sort().join(",") === "idempotent,ok,status",
    "success keys",
  );
  assert(mapHousekeepingProofSubmitRpcCode("ZP002").status === 404, "ZP002 -> 404");
  assert(mapHousekeepingProofSubmitRpcCode("ZP003").status === 409, "ZP003 -> 409");
  assert(mapHousekeepingProofSubmitRpcCode("ZP004").body.error === "expired", "ZP004 expired");
  assert(mapHousekeepingProofSubmitRpcCode("ZP005").body.error === "revoked", "ZP005 revoked");

  const token = generateHousekeepingProofToken();
  const tokenHash = hashHousekeepingProofToken(token);
  const now = new Date("2026-09-04T18:00:00.000Z");

  function baseStore(overrides: Parameters<typeof createMemoryHousekeepingProofSubmitStore>[0] = {}) {
    return createMemoryHousekeepingProofSubmitStore({
      tokens: [
        {
          token_hash: tokenHash,
          task_id: TASK_ID,
          expires_at: "2026-09-05T18:00:00.000Z",
          revoked_at: null,
        },
      ],
      tasks: [{ id: TASK_ID, status: "open", submitted_at: null }],
      photos: [{ task_id: TASK_ID, review_status: "pending" }],
      ...overrides,
    });
  }

  const badBody = await handleHousekeepingProofSubmit({
    body: { token, extra: true },
    ip: "203.0.113.1",
    now,
    store: baseStore(),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(badBody.status === 400 && badBody.body.error === "invalid", "extra keys rejected");

  const openOk = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.2",
    now,
    store: baseStore(),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(openOk.status === 200, "open + pending submits");
  assert(
    JSON.stringify(Object.keys(openOk.body).sort()) === JSON.stringify(["idempotent", "ok", "status"]),
    "success keys exact",
  );
  assert(openOk.body.ok === true && openOk.body.status === "submitted" && openOk.body.idempotent === false, "mutated submit");
  assert(!("token" in openOk.body) && !("task_id" in openOk.body) && !("photoCount" in openOk.body), "no secrets/counts");

  const attentionStore = baseStore({
    tasks: [{ id: TASK_ID, status: "needs_attention", submitted_at: "2026-09-03T12:00:00.000Z" }],
    photos: [
      { task_id: TASK_ID, review_status: "rejected" },
      { task_id: TASK_ID, review_status: "pending" },
    ],
  });
  const attentionOk = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.3",
    now,
    store: attentionStore,
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(
    attentionOk.status === 200 && attentionOk.body.idempotent === false && attentionStore.tasks[0]?.status === "submitted",
    "needs_attention + new pending submits",
  );
  assert(typeof attentionStore.tasks[0]?.submitted_at === "string", "submitted_at refreshed");

  const zeroPending = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.4",
    now,
    store: baseStore({ photos: [{ task_id: TASK_ID, review_status: "rejected" }] }),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(zeroPending.status === 409 && zeroPending.body.error === "unavailable", "zero pending rejected");

  const idemStore = baseStore({
    tasks: [{ id: TASK_ID, status: "submitted", submitted_at: "2026-09-04T10:00:00.000Z" }],
  });
  const firstStamp = idemStore.tasks[0]?.submitted_at;
  const idem = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.5",
    now,
    store: idemStore,
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(idem.status === 200 && idem.body.idempotent === true, "submitted is idempotent");
  assert(idemStore.writeCount() === 0, "idempotent does not write");
  assert(idemStore.tasks[0]?.submitted_at === firstStamp, "idempotent does not rewrite submitted_at");

  const approved = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.6",
    now,
    store: baseStore({ tasks: [{ id: TASK_ID, status: "approved" }] }),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(approved.status === 409, "approved rejected");

  const closed = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.7",
    now,
    store: baseStore({ tasks: [{ id: TASK_ID, status: "closed" }] }),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(closed.status === 409, "closed rejected");

  const unknown = await handleHousekeepingProofSubmit({
    body: { token: generateHousekeepingProofToken() },
    ip: "203.0.113.8",
    now,
    store: baseStore(),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(unknown.status === 404 && unknown.body.error === "invalid", "unknown token");

  const revoked = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.9",
    now,
    store: baseStore({
      tokens: [
        {
          token_hash: tokenHash,
          task_id: TASK_ID,
          expires_at: "2026-09-05T18:00:00.000Z",
          revoked_at: "2026-09-04T12:00:00.000Z",
        },
      ],
    }),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(revoked.status === 410 && revoked.body.error === "revoked", "revoked token");

  const expired = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.10",
    now: new Date("2026-09-06T18:00:00.000Z"),
    store: baseStore(),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(expired.status === 410 && expired.body.error === "expired", "expired token");

  const rateMap = new Map<string, number[]>();
  const hashMap = new Map<string, number[]>();
  for (let i = 0; i < HOUSEKEEPING_PROOF_SUBMIT_RATE_MAX; i += 1) {
    const hit = await handleHousekeepingProofSubmit({
      body: { token },
      ip: "203.0.113.11",
      now,
      store: baseStore({ tasks: [{ id: TASK_ID, status: "submitted" }] }),
      ipRateMap: rateMap,
      hashRateMap: hashMap,
    });
    assert(hit.status === 200, `rate warm ${i}`);
  }
  const limited = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.11",
    now,
    store: baseStore({ tasks: [{ id: TASK_ID, status: "submitted" }] }),
    ipRateMap: rateMap,
    hashRateMap: hashMap,
  });
  assert(limited.status === 429 && limited.body.error === "unavailable", "rate limited");
  assert(housekeepingProofSubmitIpRateKey("203.0.113.11").startsWith("submit:ip:"), "ip rate key");
  assert(housekeepingProofSubmitHashRateKey(tokenHash).startsWith("submit:hash:"), "hash rate key");

  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..");
  const routeSrc = readFileSync(join(root, "src/app/api/housekeeping/proof/submit/route.ts"), "utf8");
  assert(routeSrc.includes("handleHousekeepingProofSubmit"), "route uses submit handler");
  assert(routeSrc.includes("housekeepingProofBodyTooLarge"), "route body size guard");
  assert(routeSrc.includes("no-store") || routeSrc.includes("housekeepingProofJson"), "safe json helper");
  assert(!routeSrc.includes("console."), "route does not log");
  assert(!/localStorage|createBrowserClient/.test(routeSrc), "route stays server-only");

  // Concurrent double-submit contract: second call after first mutation is idempotent with no rewrite.
  const concurrent = baseStore();
  const a = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.12",
    now,
    store: concurrent,
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  const stamp = concurrent.tasks[0]?.submitted_at;
  const b = await handleHousekeepingProofSubmit({
    body: { token },
    ip: "203.0.113.13",
    now,
    store: concurrent,
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(a.body.idempotent === false && b.body.idempotent === true, "one mutation one idempotent");
  assert(concurrent.writeCount() === 1 && concurrent.tasks[0]?.submitted_at === stamp, "single write preserved");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-submit.test");
if (isDirectRun) {
  try {
    await runHousekeepingProofSubmitTests();
    console.log("housekeeping-proof-submit tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "housekeeping-proof-submit tests failed");
    process.exitCode = 1;
  }
}
