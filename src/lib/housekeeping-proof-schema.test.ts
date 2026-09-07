import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function tableBlock(sql: string, name: string) {
  const marker = `create table if not exists public.${name}`;
  const start = sql.indexOf(marker);
  assert(start >= 0, `${name} table is defined`);
  const rest = sql.slice(start);
  const next = rest.search(/\ncreate (table|index|unique index)|;\s*\n\s*create index|\nalter table/i);
  const end = next >= 0 ? next : rest.indexOf(";");
  return rest.slice(0, end >= 0 ? end : rest.length);
}

export function runHousekeepingProofSchemaTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..");
  const migrationsDir = join(root, "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith("_housekeeping_proof.sql"));
  assert(files.length === 1, "exactly one housekeeping proof migration");
  const migrationName = files[0] ?? "";
  assert(migrationName === "20260902231500_housekeeping_proof.sql", "timestamped housekeeping proof migration");
  const sql = readFileSync(join(migrationsDir, migrationName), "utf8");
  const schema = readFileSync(join(root, "supabase", "schema.sql"), "utf8");

  const propertiesCreate = schema.slice(schema.indexOf("create table if not exists public.properties"));
  const reservationsCreate = schema.slice(schema.indexOf("create table if not exists public.reservations"));
  assert(propertiesCreate.includes("id text primary key"), "properties.id is text");
  assert(reservationsCreate.includes("id text primary key"), "reservations.id is text");

  assert(sql.includes("public.properties.id and public.reservations.id are text"), "migration documents text keys");
  assert(sql.includes("housekeeping_proof_tasks"), "tasks table");
  assert(sql.includes("housekeeping_proof_tokens"), "tokens table");
  assert(sql.includes("housekeeping_proof_photos"), "photos table");
  assert(sql.includes("housekeeping-proof"), "private proof bucket");
  assert(!sql.includes("create table if not exists public.housekeeping_photos"), "does not create legacy photos table");
  assert(!sql.includes("create table if not exists public.housekeeping_reports"), "does not create legacy reports table");
  assert(!sql.includes("/housekeeping/upload"), "does not reuse the upload route");
  assert(!sql.includes("values ('housekeeping'"), "does not insert the public staff bucket");
  assert(schema.includes("create table if not exists public.housekeeping_photos"), "legacy photos table remains outside this migration");
  assert(schema.includes("create table if not exists public.housekeeping_reports"), "legacy reports table remains outside this migration");
  assert(schema.includes("values ('housekeeping', 'housekeeping', true)"), "legacy public housekeeping bucket remains outside this migration");

  assert(
    sql.includes("create unique index if not exists reservations_id_property_id_uidx"),
    "unique index on reservations(id, property_id)",
  );
  assert(sql.includes("on public.reservations (id, property_id)"), "unique index columns are id, property_id");
  assert(!/reservations_id_property_id_uidx[\s\S]{0,200}where /i.test(sql), "reservations unique index is non-partial");
  assert(
    sql.indexOf("reservations_id_property_id_uidx") < sql.indexOf("create table if not exists public.housekeeping_proof_tasks"),
    "reservations unique index is created before proof tasks",
  );

  const tasks = tableBlock(sql, "housekeeping_proof_tasks");
  assert(tasks.includes("id uuid primary key"), "task uuid pk");
  assert(tasks.includes("property_id text not null references public.properties (id)"), "task property_id text FK");
  assert(tasks.includes("reservation_id text not null"), "reservation_id is required text");
  assert(!tasks.includes("reservation_id text not null references public.reservations (id)"), "no standalone reservation_id FK");
  assert(
    tasks.includes("constraint housekeeping_proof_tasks_reservation_property_fkey"),
    "composite FK has an explicit name",
  );
  assert(
    /foreign key \(reservation_id, property_id\)\s+references public\.reservations \(id, property_id\)\s+on delete cascade/.test(
      tasks.replace(/\s+/g, " "),
    ),
    "composite task FK is (reservation_id, property_id) -> reservations(id, property_id)",
  );
  assert(
    tasks.includes("foreign key (reservation_id, property_id)") && tasks.includes("references public.reservations (id, property_id)"),
    "mismatched property/reservation pairs are prevented at database level",
  );
  assert(tasks.includes("'post_checkout'") && tasks.includes("'ready_for_checkin'"), "required stages");
  assert(!tasks.includes("pre_checkout") && !tasks.includes("during_stay"), "only the two required stages");
  assert(
    tasks.includes("'open'") &&
      tasks.includes("'submitted'") &&
      tasks.includes("'approved'") &&
      tasks.includes("'needs_attention'") &&
      tasks.includes("'closed'"),
    "task statuses",
  );
  assert(tasks.includes("created_by uuid references auth.users (id) on delete set null"), "task created_by");
  assert(tasks.includes("due_at timestamptz") && tasks.includes("submitted_at") && tasks.includes("reviewed_at"), "task timestamps");
  assert(tasks.includes("created_at timestamptz") && tasks.includes("updated_at timestamptz"), "created_at and updated_at");

  const tokens = tableBlock(sql, "housekeeping_proof_tokens");
  assert(tokens.includes("task_id uuid not null references public.housekeeping_proof_tasks (id) on delete cascade"), "token task FK");
  assert(tokens.includes("token_hash text not null unique"), "token_hash required unique");
  assert(tokens.includes("expires_at timestamptz not null"), "expires_at required");
  assert(tokens.includes("revoked_at timestamptz"), "revoked_at nullable");
  assert(tokens.includes("created_by uuid references auth.users (id) on delete set null"), "token created_by");
  assert(!/\btoken\b/.test(tokens.replace(/token_hash/g, "")), "no plaintext token column");
  assert(
    sql.includes("create unique index if not exists housekeeping_proof_tokens_one_active_per_task_idx"),
    "one active token per task",
  );
  assert(sql.includes("where revoked_at is null"), "partial unique index on non-revoked tokens");

  const photos = tableBlock(sql, "housekeeping_proof_photos");
  assert(photos.includes("task_id uuid not null references public.housekeeping_proof_tasks (id) on delete cascade"), "photo task FK");
  assert(photos.includes("storage_path text not null unique"), "storage_path unique");
  assert(photos.includes("'image/jpeg'") && photos.includes("'image/png'") && photos.includes("'image/webp'"), "image MIME types");
  assert(photos.includes("byte_size integer not null check (byte_size > 0 and byte_size <= 10485760)"), "positive byte_size with max");
  assert(photos.includes("width integer check (width is null or width > 0)"), "positive width when present");
  assert(photos.includes("height integer check (height is null or height > 0)"), "positive height when present");
  assert(photos.includes("'pending'") && photos.includes("'approved'") && photos.includes("'rejected'"), "review statuses");
  assert(photos.includes("uploaded_at timestamptz") && photos.includes("reviewed_at timestamptz"), "photo timestamps");
  assert(photos.includes("reviewed_by uuid references auth.users (id) on delete set null"), "reviewed_by");

  const forbidden = [
    "guest_name",
    "guest",
    "phone",
    "email",
    "address",
    "access_code",
    "accessCode",
    "wifi",
    "wifi_password",
    "handbook",
    "payout",
    "payment",
    "exif",
    "gps",
    "latitude",
    "longitude",
    "image_url",
  ];
  for (const marker of forbidden) {
    assert(!new RegExp(`\\b${marker}\\b`, "i").test(sql), `proof schema omits ${marker}`);
  }

  assert(sql.includes("alter table public.housekeeping_proof_tasks enable row level security"), "tasks RLS");
  assert(sql.includes("alter table public.housekeeping_proof_tokens enable row level security"), "tokens RLS");
  assert(sql.includes("alter table public.housekeeping_proof_photos enable row level security"), "photos RLS");
  assert(!/\bcreate policy\b/i.test(sql), "no client RLS policies");
  assert(!/\bto anon\b/i.test(sql) && !/\bto authenticated\b/i.test(sql), "no anon or authenticated grants via policy");
  assert(sql.includes("revoke all on table public.housekeeping_proof_tasks from anon"), "tasks revoked from anon");
  assert(sql.includes("revoke all on table public.housekeeping_proof_tokens from authenticated"), "tokens revoked from authenticated");
  assert(sql.includes("grant all on table public.housekeeping_proof_photos to service_role"), "photos granted to service_role");

  const bucketSql = sql.replace(/\r\n/g, "\n");
  assert(
    bucketSql.includes("'housekeeping-proof',\n  'housekeeping-proof',\n  false,"),
    "bucket insert is private",
  );
  assert(sql.includes("10485760"), "bucket file size is 10 MiB");
  assert(sql.includes("file_size_limit"), "bucket file-size limit");
  assert(sql.includes("allowed_mime_types"), "bucket image MIME allowlist");
  assert(sql.includes("on conflict (id) do update set"), "bucket conflict uses DO UPDATE");
  assert(!/on conflict \(id\) do nothing/i.test(sql), "bucket conflict does not use DO NOTHING");
  assert(
    /do update set\s+public = excluded\.public,\s+file_size_limit = excluded\.file_size_limit,\s+allowed_mime_types = excluded\.allowed_mime_types\s*;/i.test(
      sql.replace(/\s+/g, " "),
    ),
    "conflict update is limited to public, file_size_limit, and allowed_mime_types",
  );
  const withoutBucketConflict = sql.replace(
    /on conflict \(id\) do update set\s+public = excluded\.public,\s+file_size_limit = excluded\.file_size_limit,\s+allowed_mime_types = excluded\.allowed_mime_types\s*;/i,
    "",
  );
  assert(!/\bUPDATE\b/.test(withoutBucketConflict), "no UPDATE statement modifies existing application rows");
  assert(!/\bDELETE FROM\b/i.test(sql), "no DELETE FROM");
  assert(!/backfill/i.test(sql) || sql.includes("No backfill"), "no backfill");
  assert(!/getPublicUrl|public url|publicUrl/i.test(sql), "no public URL helpers");
  assert(!/on storage\.objects/i.test(sql), "no anonymous storage object policy");

  assert(sql.includes("create index if not exists housekeeping_proof_tasks_property_idx"), "property lookup");
  assert(sql.includes("create index if not exists housekeeping_proof_tasks_reservation_idx"), "reservation lookup");
  assert(sql.includes("create index if not exists housekeeping_proof_tasks_status_idx"), "status lookup");
  assert(sql.includes("create index if not exists housekeeping_proof_tokens_task_idx"), "token task lookup");
  assert(sql.includes("create index if not exists housekeeping_proof_photos_review_idx"), "photo review lookup");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-schema.test");
if (isDirectRun) {
  try {
    runHousekeepingProofSchemaTests();
    console.log("housekeeping-proof-schema tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "housekeeping-proof-schema tests failed");
    process.exitCode = 1;
  }
}
