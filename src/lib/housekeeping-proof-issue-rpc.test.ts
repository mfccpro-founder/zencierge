import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const APPLIED_PROOF_MIGRATION_SHA256 = "f2a4063b8519cd3295667fabdff0c7b797e336b8f59dca92a688efed52d266c5";

export function runHousekeepingProofIssueRpcTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..");
  const migrationsDir = join(root, "supabase", "migrations");
  const appliedPath = join(migrationsDir, "20260902231500_housekeeping_proof.sql");
  const rpcPath = join(migrationsDir, "20260903001500_housekeeping_proof_issue_rpc.sql");
  const applied = readFileSync(appliedPath);
  const appliedHash = createHash("sha256").update(applied).digest("hex");
  assert(appliedHash === APPLIED_PROOF_MIGRATION_SHA256, "old applied migration file remains byte-for-byte unchanged");

  const sql = readFileSync(rpcPath, "utf8");
  const appliedSql = applied.toString("utf8");
  assert(!appliedSql.includes("issue_housekeeping_proof_link_atomic"), "applied migration does not define the RPC");
  assert(!appliedSql.includes("housekeeping_proof_tasks_reservation_stage_uidx"), "applied migration does not add the reservation+stage index");

  assert(
    sql.includes("create unique index if not exists housekeeping_proof_tasks_reservation_stage_uidx"),
    "unique reservation+stage index exists",
  );
  assert(sql.includes("on public.housekeeping_proof_tasks (reservation_id, stage)"), "index columns are reservation_id, stage");
  assert(!/housekeeping_proof_tasks_reservation_stage_uidx[\s\S]{0,160}where /i.test(sql), "reservation+stage index is non-partial");

  assert(sql.includes("create or replace function public.issue_housekeeping_proof_link_atomic"), "RPC name");
  assert(/\bsecurity definer\b/i.test(sql), "function is SECURITY DEFINER");
  assert(/set search_path = pg_catalog\b/i.test(sql), "safe fixed search_path");
  assert(sql.includes("p_property_id text"), "property id input");
  assert(sql.includes("p_reservation_id text"), "reservation id input");
  assert(sql.includes("p_stage text"), "stage input");
  assert(sql.includes("p_due_at timestamptz"), "due_at input");
  assert(sql.includes("p_expires_at timestamptz"), "expires_at input");
  assert(sql.includes("p_token_hash text"), "token hash input");
  assert(sql.includes("p_created_by uuid"), "created_by input");
  assert(sql.includes("returns table(task_id uuid, expires_at timestamptz)"), "return fields are task_id and expires_at only");
  assert(!/returns table\([^)]*token/i.test(sql), "return row has no token fields");

  assert(sql.includes("from public.reservations"), "reservation/property match is checked");
  assert(sql.includes("v_reservation_property_id is distinct from p_property_id"), "reservation must belong to p_property_id");
  assert(sql.includes("housekeeping_proof_tasks_reservation_property_fkey") || appliedSql.includes("housekeeping_proof_tasks_reservation_property_fkey"), "composite FK remains additional protection");

  assert(sql.includes("'open'") && sql.includes("'submitted'") && sql.includes("'needs_attention'"), "reissue allowed statuses");
  const fnBody = sql.slice(sql.toLowerCase().indexOf("as $$"), sql.toLowerCase().lastIndexOf("$$"));
  assert(fnBody.includes("raise exception 'unavailable'"), "approved/closed cannot receive a token");
  assert(
    fnBody.includes("where public.housekeeping_proof_tasks.status in ('open', 'submitted', 'needs_attention')"),
    "conflict update only for reissue-eligible statuses",
  );
  assert(!fnBody.includes("'approved'") && !fnBody.includes("'closed'"), "approved/closed are not listed as allowed");

  const revokeAt = fnBody.indexOf("update public.housekeeping_proof_tokens");
  const insertTokenAt = fnBody.indexOf("insert into public.housekeeping_proof_tokens");
  assert(revokeAt >= 0 && insertTokenAt >= 0 && revokeAt < insertTokenAt, "revoke happens before insert inside the same function");
  assert(!/\bexception when\b/i.test(fnBody), "no exception handler swallows a failed insert after revoke");
  assert(!/\bcommit\b/i.test(fnBody), "no inner commit; failure rolls the task and prior token back together");
  assert(!/\bpragma autonomous_transaction\b/i.test(fnBody), "no autonomous transaction");

  assert(fnBody.includes("^[0-9a-f]{64}$") || fnBody.includes("'^[0-9a-f]{64}$'"), "token hash format is checked");
  assert(fnBody.includes("p_expires_at <= pg_catalog.now()"), "expiration must be in the future");
  assert(!/\bp_token\b/.test(fnBody) && !/\bplaintext\b/i.test(sql), "no plaintext token input");
  assert(!/insert into public\.housekeeping_proof_tokens \([^)]*\btoken\b/i.test(fnBody.replace(/token_hash/g, "")), "no plaintext token storage");
  assert(!/\braise (log|notice|info|warning|debug)\b/i.test(fnBody), "no logging");
  assert(!/\bexecute\b/i.test(fnBody), "no dynamic SQL");

  assert(
    !/on conflict \(reservation_id, stage\) do update\s+set[\s\S]{0,240}created_by/i.test(sql),
    "do not overwrite created_by on an existing task",
  );

  assert(sql.includes("revoke all on function public.issue_housekeeping_proof_link_atomic"), "function execute revoked");
  assert(sql.includes("from public") && sql.includes("from anon") && sql.includes("from authenticated"), "PUBLIC, anon, and authenticated cannot execute");
  assert(
    sql.includes(
      "grant execute on function public.issue_housekeeping_proof_link_atomic(text, text, text, timestamptz, timestamptz, text, uuid) to service_role",
    ),
    "execute permission is service_role only",
  );
  assert(!/grant execute[\s\S]{0,200}to (anon|authenticated|public)/i.test(sql), "no client execute grants");
  assert(!/\bcreate policy\b/i.test(sql), "no client table or Storage policies");
  assert(!/storage\.|getPublicUrl|housekeeping-proof|allowed_mime_types/i.test(sql), "no public bucket, getPublicUrl, or Storage policy");
  assert(!/guest_stay_tokens|\/guest\/s\/|issueGuestStayLink/i.test(sql), "no guest-stay tables or routes");
  assert(!/housekeeping_photos|housekeeping_reports|\/housekeeping\/upload/i.test(sql), "no legacy housekeeping tables or routes");
  assert(!/\bUPDATE\b/.test(sql.replace(/update public\.housekeeping_proof_/gi, "").replace(/on conflict \(reservation_id, stage\) do update/gi, "")), "migration DDL does not update application rows outside the function");
  assert(!/\bDELETE FROM\b/i.test(sql), "no DELETE FROM");
  assert(!/backfill/i.test(sql) || sql.includes("No backfill"), "no backfill");

  // Later additive migration: submitted tasks cannot mint/rotate links; evidence preserved.
  const blockSubmittedPath = join(migrationsDir, "20260905004500_housekeeping_proof_issue_block_submitted.sql");
  const blockSql = readFileSync(blockSubmittedPath, "utf8");
  assert(blockSql.includes("create or replace function public.issue_housekeeping_proof_link_atomic"), "block-submitted replaces issue RPC");
  const blockBody = blockSql.slice(blockSql.toLowerCase().indexOf("as $$"), blockSql.toLowerCase().lastIndexOf("$$"));
  assert(
    blockBody.includes("where public.housekeeping_proof_tasks.status in ('open', 'needs_attention')"),
    "submitted removed from reissue-eligible conflict statuses",
  );
  assert(!blockBody.includes("'submitted'") || blockBody.includes("v_existing_status = 'submitted'"), "submitted is only used as a block gate");
  assert(blockBody.includes("ERRCODE = 'ZP004'"), "submitted block uses ZP004");
  assert(blockBody.includes("MESSAGE = 'submitted'"), "submitted block message");
  assert(blockBody.includes("'open'") && blockBody.includes("'needs_attention'"), "open and needs_attention still rotate");
  assert(!/delete from public\.housekeeping_proof_/i.test(blockSql), "does not delete proof rows");
  assert(!/update public\.housekeeping_proof_photos/i.test(blockSql), "does not clear photos");
  assert(!blockBody.includes("status = 'open'"), "does not reset existing task status to open on conflict");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-issue-rpc.test");
if (isDirectRun) {
  try {
    runHousekeepingProofIssueRpcTests();
    console.log("housekeeping-proof-issue-rpc tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "housekeeping-proof-issue-rpc tests failed");
    process.exitCode = 1;
  }
}
