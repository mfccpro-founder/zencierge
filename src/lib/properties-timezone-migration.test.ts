import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOUSEKEEPING_PROOF_OPTIONS_PROPERTY_COLUMNS,
  housekeepingProofOptionsTimeZoneIsConfigured,
} from "./housekeeping-proof-options";
import { HOUSEKEEPING_PROOF_PROPERTY_WINDOW_COLUMNS, housekeepingProofBoundaryAt } from "./housekeeping-proof";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const APPLIED_PROOF_MIGRATION_SHA256 = "f2a4063b8519cd3295667fabdff0c7b797e336b8f59dca92a688efed52d266c5";
const APPLIED_RPC_MIGRATION_SHA256 = "b827d95b64e991e507c33c0b88391cab016eac6f08de73bdaf0788d5285a7d4c";
const CANONICAL_TIMEZONE = "America/New_York";
const PREVIOUS_LATEST_MIGRATION_STAMP = 20260903001500;
const EXPECTED_MIGRATION_NAME = "20260903174600_properties_timezone.sql";

function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function runPropertiesTimezoneMigrationTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..");
  const migrationsDir = join(root, "supabase", "migrations");
  const schemaSql = readFileSync(join(root, "supabase", "schema.sql"), "utf8");
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  const stamps = names.map((name) => {
    const match = /^(\d{14})_/.exec(name);
    assert(Boolean(match), `migration filename has a 14-digit timestamp: ${name}`);
    return Number(match?.[1]);
  });
  assert(new Set(stamps).size === stamps.length, "migration timestamps are unique");

  const timezoneFiles = names.filter((name) => name.endsWith("_properties_timezone.sql"));
  assert(timezoneFiles.length === 1, "exactly one properties timezone migration");
  const migrationName = timezoneFiles[0] ?? "";
  assert(migrationName === EXPECTED_MIGRATION_NAME, "dated timezone migration uses the next unique timestamp");
  const stamp = Number(/^(\d{14})_/.exec(migrationName)?.[1]);
  assert(stamp > PREVIOUS_LATEST_MIGRATION_STAMP, "timezone migration is after the applied proof RPC migration");

  const sql = readFileSync(join(migrationsDir, migrationName), "utf8");
  const addAt = sql.search(/add column if not exists timezone text\b/i);
  const updateAt = sql.search(/update public\.properties/i);
  const defaultAt = sql.search(/alter column timezone set default 'America\/New_York'/i);
  const notNullAt = sql.search(/alter column timezone set not null/i);
  assert(addAt >= 0, "adds timezone only if missing");
  assert(updateAt >= 0, "repairs legacy timezone values");
  assert(defaultAt >= 0, "sets canonical default America/New_York");
  assert(notNullAt >= 0, "sets NOT NULL");
  assert(addAt < updateAt && updateAt < defaultAt && defaultAt < notNullAt, "NOT NULL is set only after null/blank repair");
  assert(!/add column if not exists timezone text not null/i.test(sql), "add does not set NOT NULL before repair");

  assert(
    /set timezone = 'America\/New_York'\s*where timezone is null or btrim\(timezone\) = ''/i.test(sql),
    "repairs only null/blank values with America/New_York",
  );
  assert(!/set timezone = 'America\/New_York'\s*;/i.test(sql), "does not overwrite every timezone");
  assert(!/where timezone is not null/i.test(sql), "does not rewrite populated timezones");

  assert(
    schemaSql.includes("alter table public.properties add column if not exists timezone text not null default 'America/New_York';"),
    "schema.sql keeps the canonical timezone definition",
  );
  assert(sql.includes(`'${CANONICAL_TIMEZONE}'`), "migration uses the canonical default string");

  assert(!/\bhost_id\b/.test(sql), "does not touch host_id");
  assert(!/\breservations\b/i.test(sql), "does not touch reservations");
  assert(!/housekeeping_proof/i.test(sql), "does not touch housekeeping proof tables");
  assert(!/guest_stay/i.test(sql), "does not touch guest-stay tables");
  assert(!/\b(policy|enable row level security|revoke |grant )\b/i.test(sql), "does not touch RLS or grants");
  assert(!/storage|bucket/i.test(sql), "does not touch Storage");
  assert(!/\btoken\b/i.test(sql), "does not touch tokens");
  assert(!/create (or replace )?function|create trigger|execute |format\(/i.test(sql), "no functions, triggers, or dynamic SQL");
  assert(!/\b(api|route|fetch)\b/i.test(sql), "no API changes");
  assert(!/\b(id|name)\s*=/.test(sql), "does not rewrite property id or name");

  const proofPath = join(migrationsDir, "20260902231500_housekeeping_proof.sql");
  const rpcPath = join(migrationsDir, "20260903001500_housekeeping_proof_issue_rpc.sql");
  assert(sha256File(proofPath) === APPLIED_PROOF_MIGRATION_SHA256, "housekeeping proof migration remains byte-for-byte unchanged");
  assert(sha256File(rpcPath) === APPLIED_RPC_MIGRATION_SHA256, "housekeeping proof RPC migration remains byte-for-byte unchanged");

  const optionsSrc = readFileSync(join(here, "housekeeping-proof-options.ts"), "utf8");
  const proofSrc = readFileSync(join(here, "housekeeping-proof.ts"), "utf8");
  assert(HOUSEKEEPING_PROOF_OPTIONS_PROPERTY_COLUMNS === "id, name, timezone, check_in, check_out", "proof-options still selects timezone");
  assert(HOUSEKEEPING_PROOF_PROPERTY_WINDOW_COLUMNS === "id, timezone, check_in, check_out", "proof-links still selects timezone");
  assert(optionsSrc.includes("housekeepingProofOptionsTimeZoneIsConfigured"), "proof-options still requires a configured timezone");
  assert(proofSrc.includes("housekeepingProofBoundaryAt"), "proof-links still validates timezone at window time");
  assert(!housekeepingProofOptionsTimeZoneIsConfigured(""), "empty timezone is not eligible");
  assert(housekeepingProofBoundaryAt({ date: "2026-09-03", time: "11:00 AM", timeZone: "" }) === null, "empty timezone does not invent a window");
  assert(!optionsSrc.includes('"UTC"') && !optionsSrc.includes("'UTC'"), "proof-options has no UTC fallback");
  assert(!/timezone[^\n]{0,120}["']UTC["']/.test(proofSrc), "proof-links has no UTC timezone fallback");
}

const isDirectRun = process.argv[1]?.includes("properties-timezone-migration.test");
if (isDirectRun) {
  try {
    runPropertiesTimezoneMigrationTests();
    console.log("properties-timezone-migration tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "properties-timezone-migration tests failed");
    process.exitCode = 1;
  }
}
