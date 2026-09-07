import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { housekeepingProofNow } from "@/lib/housekeeping-proof-clock";
import {
  HOUSEKEEPING_PROOF_TOKEN_LOOKUP_COLUMNS,
  hashHousekeepingProofToken,
  housekeepingProofAdminClient,
  housekeepingProofRateLimited,
  isValidHousekeepingProofTokenFormat,
  type HousekeepingProofError,
  type HousekeepingProofRateMap,
} from "@/lib/housekeeping-proof";

/** Server-only. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("housekeeping-proof-photo is server-only");
}

export const HOUSEKEEPING_PROOF_PHOTO_BUCKET = "housekeeping-proof";
export const HOUSEKEEPING_PROOF_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const HOUSEKEEPING_PROOF_PHOTO_MIN_BYTES = 1;
export const HOUSEKEEPING_PROOF_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const HOUSEKEEPING_PROOF_MULTIPART_MAX_BYTES =
  HOUSEKEEPING_PROOF_PHOTO_MAX_BYTES + HOUSEKEEPING_PROOF_MULTIPART_OVERHEAD_BYTES;
export const HOUSEKEEPING_PROOF_PHOTO_MAX_PIXELS = 20_000_000;
export const HOUSEKEEPING_PROOF_PHOTO_MAX_EDGE = 2048;
export const HOUSEKEEPING_PROOF_PHOTO_JPEG_QUALITY = 80;
/** Application-level cap only. Not a database uniqueness or locking guarantee. */
export const HOUSEKEEPING_PROOF_PHOTO_MAX_PER_TASK = 8;
export const HOUSEKEEPING_PROOF_UPLOAD_RATE_MAX = 8;
export const HOUSEKEEPING_PROOF_UPLOAD_TASK_COLUMNS = "id, status";
export const HOUSEKEEPING_PROOF_PHOTO_INSERT_COLUMNS = [
  "task_id",
  "storage_path",
  "content_type",
  "byte_size",
  "width",
  "height",
] as const;
export const HOUSEKEEPING_PROOF_PHOTO_CONTENT_TYPE = "image/jpeg";

const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "jpg", "png", "webp"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_RE = /^proof\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;

const ipRateHits: HousekeepingProofRateMap = new Map();
const hashRateHits: HousekeepingProofRateMap = new Map();

export type HousekeepingProofPhotoInsert = {
  task_id: string;
  storage_path: string;
  content_type: typeof HOUSEKEEPING_PROOF_PHOTO_CONTENT_TYPE;
  byte_size: number;
  width: number;
  height: number;
};

export type HousekeepingProofPhotoStore = {
  findTokenByHash(tokenHash: string): Promise<{ task_id: string; expires_at: string; revoked_at: string | null } | null>;
  getTaskUpload(taskId: string): Promise<{ id: string; status: string } | null>;
  countPhotos(taskId: string): Promise<number>;
  insertPhoto(row: HousekeepingProofPhotoInsert): Promise<void>;
  uploadObject(path: string, bytes: Buffer, contentType: string): Promise<void>;
  removeObject(path: string): Promise<void>;
};

function err(status: number, error: HousekeepingProofError) {
  return { status, body: { error } as Record<string, unknown> };
}

export function housekeepingProofUploadIpRateKey(ip: string) {
  return `upload:ip:${ip}`;
}

export function housekeepingProofUploadHashRateKey(tokenHash: string) {
  return `upload:hash:${tokenHash}`;
}

export function housekeepingProofUploadContentLengthRejected(header: string | null) {
  if (header == null) return true;
  const text = header.trim();
  if (!/^\d+$/.test(text)) return true;
  const size = Number(text);
  return size <= 0 || size > HOUSEKEEPING_PROOF_MULTIPART_MAX_BYTES;
}

export function randomHousekeepingProofPhotoPath() {
  return `proof/${randomUUID()}.jpg`;
}

export function isHousekeepingProofPhotoPath(path: string) {
  return PATH_RE.test(path);
}

export function parseHousekeepingProofUploadForm(
  form: FormData,
): { token: string; photo: File } | { error: HousekeepingProofError } {
  const names = [...new Set(form.keys())];
  if (names.length !== 2 || !names.includes("token") || !names.includes("photo")) return { error: "invalid" };
  const tokens = form.getAll("token");
  const photos = form.getAll("photo");
  if (tokens.length !== 1 || photos.length !== 1) return { error: "invalid" };
  const tokenValue = tokens[0];
  const photoValue = photos[0];
  const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (!isValidHousekeepingProofTokenFormat(token)) return { error: "invalid" };
  if (!(photoValue instanceof File)) return { error: "invalid" };
  if (photoValue.size < HOUSEKEEPING_PROOF_PHOTO_MIN_BYTES || photoValue.size > HOUSEKEEPING_PROOF_PHOTO_MAX_BYTES) {
    return { error: "invalid" };
  }
  return { token, photo: photoValue };
}

export async function normalizeHousekeepingProofPhoto(
  bytes: Buffer,
): Promise<
  | { buffer: Buffer; width: number; height: number; byteSize: number }
  | { error: "invalid" | "unavailable" }
> {
  if (bytes.length < HOUSEKEEPING_PROOF_PHOTO_MIN_BYTES || bytes.length > HOUSEKEEPING_PROOF_PHOTO_MAX_BYTES) {
    return { error: "invalid" as const };
  }

  let format: string | undefined;
  try {
    const probe = sharp(bytes, {
      failOn: "error",
      limitInputPixels: HOUSEKEEPING_PROOF_PHOTO_MAX_PIXELS,
    });
    const meta = await probe.metadata();
    format = meta.format;
    if (!format || !ALLOWED_INPUT_FORMATS.has(format)) return { error: "invalid" as const };

    const out = await probe
      .rotate()
      .resize(HOUSEKEEPING_PROOF_PHOTO_MAX_EDGE, HOUSEKEEPING_PROOF_PHOTO_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: HOUSEKEEPING_PROOF_PHOTO_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });

    if (!out.data.length || out.data.length > HOUSEKEEPING_PROOF_PHOTO_MAX_BYTES) return { error: "unavailable" as const };
    if (!out.info.width || !out.info.height || out.info.width <= 0 || out.info.height <= 0) {
      return { error: "unavailable" as const };
    }
    return {
      buffer: out.data,
      width: out.info.width,
      height: out.info.height,
      byteSize: out.data.length,
    };
  } catch {
    return { error: "invalid" as const };
  }
}

function canUploadTaskStatus(status: string) {
  return status === "open" || status === "needs_attention";
}

export async function handleHousekeepingProofPhotoUpload(input: {
  contentLength: string | null;
  readFormData: () => Promise<FormData>;
  ip: string;
  now?: Date;
  nodeEnv?: string;
  timeZone?: string;
  store?: HousekeepingProofPhotoStore;
  getStore?: () => HousekeepingProofPhotoStore | null;
  normalize?: typeof normalizeHousekeepingProofPhoto;
  ipRateMap?: HousekeepingProofRateMap;
  hashRateMap?: HousekeepingProofRateMap;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (housekeepingProofUploadContentLengthRejected(input.contentLength)) {
    return err(400, "invalid");
  }

  let form: FormData;
  try {
    form = await input.readFormData();
  } catch {
    return err(400, "invalid");
  }

  const parsed = parseHousekeepingProofUploadForm(form);
  if ("error" in parsed) return err(400, parsed.error);

  const tokenHash = hashHousekeepingProofToken(parsed.token);
  const ipKey = housekeepingProofUploadIpRateKey(input.ip || "local");
  const hashKey = housekeepingProofUploadHashRateKey(tokenHash);
  if (
    housekeepingProofRateLimited(input.ipRateMap ?? ipRateHits, ipKey, HOUSEKEEPING_PROOF_UPLOAD_RATE_MAX) ||
    housekeepingProofRateLimited(input.hashRateMap ?? hashRateHits, hashKey, HOUSEKEEPING_PROOF_UPLOAD_RATE_MAX)
  ) {
    return err(429, "unavailable");
  }

  const store = input.store ?? input.getStore?.() ?? null;
  if (!store) return err(503, "unavailable");

  let tokenRow;
  try {
    tokenRow = await store.findTokenByHash(tokenHash);
  } catch {
    return err(503, "unavailable");
  }
  if (!tokenRow) return err(404, "invalid");
  if (tokenRow.revoked_at) return err(410, "revoked");
  const now =
    input.now ??
    housekeepingProofNow({
      nodeEnv: input.nodeEnv,
      timeZone: input.timeZone,
    });
  if (Number.isNaN(Date.parse(tokenRow.expires_at)) || new Date(tokenRow.expires_at).getTime() <= now.getTime()) {
    return err(410, "expired");
  }

  let task;
  try {
    task = await store.getTaskUpload(tokenRow.task_id);
  } catch {
    return err(503, "unavailable");
  }
  if (!task || !UUID_RE.test(task.id) || !canUploadTaskStatus(task.status)) return err(409, "unavailable");

  let count;
  try {
    count = await store.countPhotos(task.id);
  } catch {
    return err(503, "unavailable");
  }
  if (count >= HOUSEKEEPING_PROOF_PHOTO_MAX_PER_TASK) return err(409, "unavailable");

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await parsed.photo.arrayBuffer());
  } catch {
    return err(400, "invalid");
  }

  const normalize = input.normalize ?? normalizeHousekeepingProofPhoto;
  const normalized = await normalize(bytes);
  if ("error" in normalized) {
    return err(normalized.error === "unavailable" ? 503 : 400, normalized.error);
  }

  const storagePath = randomHousekeepingProofPhotoPath();
  try {
    await store.uploadObject(storagePath, normalized.buffer, HOUSEKEEPING_PROOF_PHOTO_CONTENT_TYPE);
  } catch {
    return err(503, "unavailable");
  }

  try {
    await store.insertPhoto({
      task_id: task.id,
      storage_path: storagePath,
      content_type: HOUSEKEEPING_PROOF_PHOTO_CONTENT_TYPE,
      byte_size: normalized.byteSize,
      width: normalized.width,
      height: normalized.height,
    });
  } catch {
    try {
      await store.removeObject(storagePath);
    } catch {
      // Cleanup is best-effort; never expose the path or cleanup result.
    }
    return err(503, "unavailable");
  }

  return { status: 200, body: { ok: true } };
}

export type MemoryHousekeepingProofPhotoRows = {
  tokens?: Array<{ token_hash: string; task_id: string; expires_at: string; revoked_at: string | null }>;
  tasks?: Array<{ id: string; status: string }>;
  photoCount?: Record<string, number>;
  failInsert?: boolean;
  failUpload?: boolean;
};

export function createMemoryHousekeepingProofPhotoStore(rows: MemoryHousekeepingProofPhotoRows = {}) {
  const tokens = [...(rows.tokens ?? [])];
  const tasks = [...(rows.tasks ?? [])];
  const photoCount = { ...(rows.photoCount ?? {}) };
  const uploaded: Array<{ path: string; bytes: Buffer; contentType: string; upsert?: boolean }> = [];
  const removed: string[] = [];
  const inserts: HousekeepingProofPhotoInsert[] = [];

  const store: HousekeepingProofPhotoStore & {
    uploaded: typeof uploaded;
    removed: string[];
    inserts: HousekeepingProofPhotoInsert[];
  } = {
    uploaded,
    removed,
    inserts,
    async findTokenByHash(tokenHash) {
      return tokens.find((row) => row.token_hash === tokenHash) ?? null;
    },
    async getTaskUpload(taskId) {
      return tasks.find((row) => row.id === taskId) ?? null;
    },
    async countPhotos(taskId) {
      return photoCount[taskId] ?? 0;
    },
    async insertPhoto(row) {
      if (rows.failInsert) throw new Error("unavailable");
      inserts.push({ ...row });
      photoCount[row.task_id] = (photoCount[row.task_id] ?? 0) + 1;
    },
    async uploadObject(path, bytes, contentType) {
      if (rows.failUpload) throw new Error("unavailable");
      uploaded.push({ path, bytes, contentType, upsert: false });
    },
    async removeObject(path) {
      removed.push(path);
    },
  };
  return store;
}

export function createSupabaseHousekeepingProofPhotoStore(admin: SupabaseClient): HousekeepingProofPhotoStore {
  return {
    async findTokenByHash(tokenHash) {
      const { data, error } = await admin
        .from("housekeeping_proof_tokens")
        .select(HOUSEKEEPING_PROOF_TOKEN_LOOKUP_COLUMNS)
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      const taskId = typeof row.task_id === "string" ? row.task_id : "";
      const expiresAt = typeof row.expires_at === "string" ? row.expires_at : "";
      if (!taskId || !expiresAt) return null;
      return {
        task_id: taskId,
        expires_at: expiresAt,
        revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null,
      };
    },
    async getTaskUpload(taskId) {
      const { data, error } = await admin
        .from("housekeeping_proof_tasks")
        .select(HOUSEKEEPING_PROOF_UPLOAD_TASK_COLUMNS)
        .eq("id", taskId)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const status = typeof row.status === "string" ? row.status : "";
      if (!id || !status) return null;
      return { id, status };
    },
    async countPhotos(taskId) {
      const { error, count } = await admin
        .from("housekeeping_proof_photos")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId);
      if (error || typeof count !== "number") throw new Error("unavailable");
      return count;
    },
    async insertPhoto(row) {
      const { error } = await admin.from("housekeeping_proof_photos").insert({
        task_id: row.task_id,
        storage_path: row.storage_path,
        content_type: row.content_type,
        byte_size: row.byte_size,
        width: row.width,
        height: row.height,
      });
      if (error) throw new Error("unavailable");
    },
    async uploadObject(path, bytes, contentType) {
      const { error } = await admin.storage.from(HOUSEKEEPING_PROOF_PHOTO_BUCKET).upload(path, bytes, {
        upsert: false,
        contentType,
      });
      if (error) throw new Error("unavailable");
    },
    async removeObject(path) {
      await admin.storage.from(HOUSEKEEPING_PROOF_PHOTO_BUCKET).remove([path]);
    },
  };
}

export function housekeepingProofPhotoAdminClient() {
  return housekeepingProofAdminClient();
}
