/** Server-only storage for complete TTS audio. Host /api/tts uses it only when AI_USAGE_HOST_TTS_METER=1. Guest routes do not. */
if (typeof window !== "undefined") {
  throw new Error("ai-usage-audio is server-only");
}

import { randomUUID } from "node:crypto";
import { AI_USAGE_AUDIO_BUCKET, AI_USAGE_METER_RPC, type AiUsageMeterRpcClient } from "@/lib/ai-usage-meter";

/** 5 MiB. Matches the private bucket file_size_limit. */
export const AI_USAGE_TTS_AUDIO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Application retention. The bucket has no lifecycle expiry.
 * expires_at is the earlier of the logical request expiry and now plus this window.
 * Pending uploads older than 15 minutes are marked by mark_ai_usage_audio_for_cleanup.
 */
export const AI_USAGE_TTS_AUDIO_RETENTION_HOURS_DEFAULT = 24;
export const AI_USAGE_TTS_AUDIO_RETENTION_HOURS_MAX = 168;
export const AI_USAGE_AUDIO_CLEANUP_BATCH = 50;
/** Same window mark_ai_usage_audio_for_cleanup uses for pending uploads. */
export const AI_USAGE_AUDIO_UNREGISTERED_GRACE_MS = 15 * 60 * 1000;

const ALLOWED_CONTENT_TYPES = ["audio/mpeg", "audio/wav", "audio/pcm"] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANDOM_OBJECT_KEY = /^audio\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type AiUsageAudioObjectListing = {
  key: string;
  createdAt: string;
  metadata: Record<string, string>;
};

export type AiUsageAudioStorage = {
  upload(
    objectKey: string,
    bytes: Uint8Array,
    contentType: string,
    metadata: Record<string, string>,
  ): Promise<{ ok: true } | { ok: false; alreadyExists: boolean; message: string }>;
  download(
    objectKey: string,
  ): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; notFound: boolean; message: string }>;
  remove(objectKey: string): Promise<{ ok: true } | { ok: false; notFound: boolean; message: string }>;
  list(prefix: string): Promise<{ ok: true; objects: AiUsageAudioObjectListing[] } | { ok: false; message: string }>;
};

export type AiUsageAudioDeps = {
  rpc: AiUsageMeterRpcClient;
  storage: AiUsageAudioStorage;
  now?: () => Date;
  newObjectKey?: () => string;
};

export type StoreAiUsageAudioResult =
  | { ok: true; objectKey: string; byteLength: number; contentType: string; expiresAt: string }
  | {
      ok: false;
      reason:
        | "invalid"
        | "upload_failed"
        | "already_exists"
        | "orphan_registered"
        | "orphan_removed"
        | "orphan_remove_failed"
        | "confirmation_unknown";
      objectKey?: string;
      message: string;
    };

export type ReadAiUsageReplayAudioResult =
  | { ok: true; bytes: Uint8Array; contentType: string; byteLength: number }
  | { ok: false; reason: "unavailable" | "incomplete" | "download_failed"; message: string };

export type CleanupAiUsageAudioResult = {
  ok: boolean;
  marked: number;
  listed: number;
  acknowledged: number;
  retry: number;
  skipped: number;
  recovered: number;
  untrackedDeferred: number;
  message?: string;
};

type StorageError = { message?: string; statusCode?: string | number } | null;

type BucketApi = {
  upload(
    path: string,
    body: Blob,
    options?: { contentType?: string; upsert?: boolean; cacheControl?: string; metadata?: Record<string, string> },
  ): Promise<{ error: StorageError }>;
  download(path: string): Promise<{ data: Blob | null; error: StorageError }>;
  remove(paths: string[]): Promise<{ data: unknown; error: StorageError }>;
  list(
    prefix: string,
    options?: { limit?: number; offset?: number; sortBy?: { column: string; order: string } },
  ): Promise<{
    data: Array<{ name?: string | null; id?: string | null; created_at?: string | null; metadata?: Record<string, unknown> | null }> | null;
    error: StorageError;
  }>;
};

export function aiUsageTtsAudioRetentionHours(raw = process.env.AI_USAGE_TTS_AUDIO_RETENTION_HOURS): number {
  if (raw == null || String(raw).trim() === "") return AI_USAGE_TTS_AUDIO_RETENTION_HOURS_DEFAULT;
  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > AI_USAGE_TTS_AUDIO_RETENTION_HOURS_MAX) {
    return AI_USAGE_TTS_AUDIO_RETENTION_HOURS_DEFAULT;
  }
  return parsed;
}

export function aiUsageTtsAudioExpiresAt(
  now: Date,
  requestExpiresAt: Date,
  retentionHours = aiUsageTtsAudioRetentionHours(),
): Date {
  const cap = new Date(now.getTime() + retentionHours * 60 * 60 * 1000);
  return requestExpiresAt.getTime() < cap.getTime() ? requestExpiresAt : cap;
}

export function newAiUsageAudioObjectKey(randomUuid: () => string = randomUUID): string {
  const key = `audio/${randomUuid().toLowerCase()}`;
  if (!RANDOM_OBJECT_KEY.test(key)) {
    throw new Error("audio object key is not a random id");
  }
  return key;
}

export function isSafeAudioObjectKey(key: string): boolean {
  if (key.length < 1 || key.length > 240) return false;
  if (key.includes("..") || key.includes("\\") || key.includes("\0") || key.startsWith("/")) return false;
  return /^[a-z0-9][a-z0-9/_-]{0,239}$/.test(key);
}

export function isCompleteAiUsageAudio(contentType: string, bytes: Uint8Array): boolean {
  if (bytes.byteLength < 1 || bytes.byteLength > AI_USAGE_TTS_AUDIO_MAX_BYTES) return false;
  if (contentType === "audio/mpeg") {
    if (bytes.byteLength < 3) return false;
    const id3 = ascii(bytes, 0, 3) === "ID3";
    const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    return id3 || frame;
  }
  if (contentType === "audio/wav") {
    if (bytes.byteLength < 12) return false;
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
  }
  if (contentType === "audio/pcm") return true;
  return false;
}

export function createAiUsageAudioStorage(fromBucket: (bucket: string) => BucketApi): AiUsageAudioStorage {
  const bucket = fromBucket(AI_USAGE_AUDIO_BUCKET);
  return {
    async upload(objectKey, bytes, contentType, metadata) {
      const { error } = await bucket.upload(objectKey, new Blob([Uint8Array.from(bytes)], { type: contentType }), {
        contentType,
        upsert: false,
        cacheControl: "private, max-age=0",
        metadata,
      });
      if (!error) return { ok: true };
      const message = error.message ?? "upload failed";
      return { ok: false, alreadyExists: isAlreadyExists(message, error.statusCode), message };
    },
    async download(objectKey) {
      try {
        const { data, error } = await bucket.download(objectKey);
        if (error) {
          const message = error.message ?? "storage read failed";
          return { ok: false, notFound: isExplicitlyMissing(message, error.statusCode), message };
        }
        if (!data) return { ok: false, notFound: false, message: "storage read failed" };
        return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
      } catch (error) {
        return { ok: false, notFound: false, message: errorMessage(error) };
      }
    },
    async remove(objectKey) {
      const { error } = await bucket.remove([objectKey]);
      if (!error) return { ok: true };
      const message = error.message ?? "remove failed";
      return { ok: false, notFound: isExplicitlyMissing(message, error.statusCode), message };
    },
    async list(prefix) {
      const objects: AiUsageAudioObjectListing[] = [];
      const pageSize = 100;
      for (let offset = 0; offset < 1000; offset += pageSize) {
        const { data, error } = await bucket.list(prefix, {
          limit: pageSize,
          offset,
          sortBy: { column: "created_at", order: "asc" },
        });
        if (error) return { ok: false, message: error.message ?? "list failed" };
        const rows = data ?? [];
        for (const row of rows) {
          if (!row?.name || row.id == null) continue;
          objects.push({
            key: `${prefix}/${row.name}`,
            createdAt: typeof row.created_at === "string" ? row.created_at : "",
            metadata: stringMetadata(row.metadata),
          });
        }
        if (rows.length < pageSize) break;
      }
      return { ok: true, objects };
    },
  };
}

export async function storeAiUsageAttemptAudio(
  deps: AiUsageAudioDeps,
  input: {
    attemptId: string;
    acquisitionToken: string;
    bytes: Uint8Array;
    contentType: string;
    requestExpiresAt: string;
  },
): Promise<StoreAiUsageAudioResult> {
  const contentType = input.contentType.trim().toLowerCase();
  const now = (deps.now ?? (() => new Date()))();
  const requestExpiresAt = new Date(input.requestExpiresAt);
  if (!UUID_PATTERN.test(input.attemptId) || !UUID_PATTERN.test(input.acquisitionToken)) {
    return { ok: false, reason: "invalid", message: "attempt and token must be ids" };
  }
  if (!isAllowedContentType(contentType) || !isCompleteAiUsageAudio(contentType, input.bytes)) {
    return { ok: false, reason: "invalid", message: "audio must be complete mpeg, wav, or pcm within the size limit" };
  }
  if (Number.isNaN(requestExpiresAt.getTime()) || requestExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "invalid", message: "request expiry must still be in the future" };
  }
  const expiresAt = aiUsageTtsAudioExpiresAt(now, requestExpiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "invalid", message: "audio expiry must still be in the future" };
  }

  const objectKey = (deps.newObjectKey ?? newAiUsageAudioObjectKey)();
  if (!RANDOM_OBJECT_KEY.test(objectKey)) {
    return { ok: false, reason: "invalid", message: "object key must be a random id" };
  }

  const uploaded = await deps.storage.upload(objectKey, input.bytes, contentType, {
    attempt_id: input.attemptId,
    acquisition_token: input.acquisitionToken,
    byte_length: String(input.bytes.byteLength),
    content_type: contentType,
    expires_at: expiresAt.toISOString(),
  });
  if (!uploaded.ok) {
    return {
      ok: false,
      reason: uploaded.alreadyExists ? "already_exists" : "upload_failed",
      objectKey,
      message: uploaded.message,
    };
  }

  const confirmed = await confirmUploadedObject(deps, {
    attemptId: input.attemptId,
    acquisitionToken: input.acquisitionToken,
    objectKey,
    byteLength: input.bytes.byteLength,
    contentType,
    expiresAt: expiresAt.toISOString(),
  });
  if (confirmed === "committed") {
    return {
      ok: true,
      objectKey,
      byteLength: input.bytes.byteLength,
      contentType,
      expiresAt: expiresAt.toISOString(),
    };
  }
  if (confirmed === "orphan") {
    return {
      ok: false,
      reason: "orphan_registered",
      objectKey,
      message: "the lease was not current, so the object was queued for cleanup",
    };
  }
  if (confirmed === "unknown") {
    return {
      ok: false,
      reason: "confirmation_unknown",
      objectKey,
      message: "confirmation did not return, so the uploaded object was left in place",
    };
  }

  const removed = await removeOnlyThisObject(deps.storage, objectKey);
  if (removed) {
    return {
      ok: false,
      reason: "orphan_removed",
      objectKey,
      message: "confirmation refused the object, so the unregistered upload was removed",
    };
  }
  return {
    ok: false,
    reason: "orphan_remove_failed",
    objectKey,
    message: "confirmation refused the object and the unregistered upload could not be removed",
  };
}

export async function readAiUsageReplayAudio(
  deps: AiUsageAudioDeps,
  input: { clientUsageKey: string; billingSubject: string },
): Promise<ReadAiUsageReplayAudioResult> {
  const lookup = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.replay, {
    p_client_usage_key: input.clientUsageKey,
    p_billing_subject: input.billingSubject,
  });
  if (lookup.error) return { ok: false, reason: "unavailable", message: lookup.error };
  const row = lookup.rows[0];
  const status = typeof row?.result_status === "string" ? row.result_status : "unavailable";
  const objectKey = typeof row?.result_object_key === "string" ? row.result_object_key : "";
  const byteLength = typeof row?.result_byte_length === "number" ? row.result_byte_length : 0;
  const contentType = typeof row?.result_content_type === "string" ? row.result_content_type : "";
  if (status !== "ready" || !isSafeAudioObjectKey(objectKey) || byteLength < 1 || !isAllowedContentType(contentType)) {
    return { ok: false, reason: "unavailable", message: "replay audio is not available" };
  }

  let downloaded: Awaited<ReturnType<AiUsageAudioStorage["download"]>>;
  try {
    downloaded = await deps.storage.download(objectKey);
  } catch (error) {
    return { ok: false, reason: "download_failed", message: errorMessage(error) };
  }
  if (!downloaded.ok) {
    return {
      ok: false,
      reason: downloaded.notFound ? "unavailable" : "download_failed",
      message: downloaded.message,
    };
  }
  if (downloaded.bytes.byteLength !== byteLength || !isCompleteAiUsageAudio(contentType, downloaded.bytes)) {
    return { ok: false, reason: "incomplete", message: "stored audio does not match the registry" };
  }
  return { ok: true, bytes: downloaded.bytes, contentType, byteLength };
}

export async function cleanupAiUsageAudioBatch(
  deps: AiUsageAudioDeps,
  options?: { now?: string; limit?: number },
): Promise<CleanupAiUsageAudioResult> {
  const limit = normalizeBatchLimit(options?.limit);
  const marked = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.markAudioCleanup, {
    p_now: options?.now ?? null,
  });
  if (marked.error) {
    return emptyCleanup(marked.error);
  }
  const listed = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.listAudioCleanup, {});
  if (listed.error) {
    return { ...emptyCleanup(listed.error), marked: numberField(marked.rows[0], "result_marked") };
  }

  let acknowledged = 0;
  let retry = 0;
  let skipped = 0;
  const keys = listed.rows
    .map((row) => (typeof row.result_object_key === "string" ? row.result_object_key : ""))
    .slice(0, limit);
  for (const objectKey of keys) {
    if (!isSafeAudioObjectKey(objectKey)) {
      skipped += 1;
      continue;
    }
    const absent = await storageAbsence(deps.storage, objectKey);
    if (absent !== "absent") {
      retry += 1;
      continue;
    }
    const ack = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.acknowledgeAudioCleanup, {
      p_object_key: objectKey,
    });
    if (ack.error || !asBool(ack.rows[0]?.result_acknowledged)) {
      retry += 1;
      continue;
    }
    acknowledged += 1;
  }

  const untracked = await recoverUnregisteredUploads(deps, (deps.now ?? (() => new Date()))());
  return {
    ok: true,
    marked: numberField(marked.rows[0], "result_marked"),
    listed: listed.rows.length,
    acknowledged: acknowledged + untracked.acknowledged,
    retry,
    skipped,
    recovered: untracked.recovered,
    untrackedDeferred: untracked.deferred,
  };
}

async function confirmUploadedObject(
  deps: AiUsageAudioDeps,
  input: {
    attemptId: string;
    acquisitionToken: string;
    objectKey: string;
    byteLength: number;
    contentType: string;
    expiresAt: string;
  },
): Promise<"committed" | "orphan" | "refused" | "unknown"> {
  const args = {
    p_attempt_id: input.attemptId,
    p_acquisition_token: input.acquisitionToken,
    p_object_key: input.objectKey,
    p_byte_length: input.byteLength,
    p_content_type: input.contentType,
    p_expires_at: input.expiresAt,
  };
  let call = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.commitAudio, args);
  if (call.error) call = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.commitAudio, args);
  if (call.error || !call.rows[0]) return "unknown";
  if (asBool(call.rows[0].result_committed)) return "committed";
  if (asBool(call.rows[0].result_orphan)) return "orphan";
  return "refused";
}

async function removeOnlyThisObject(storage: AiUsageAudioStorage, objectKey: string): Promise<boolean> {
  if (!RANDOM_OBJECT_KEY.test(objectKey)) return false;
  return (await storageAbsence(storage, objectKey)) === "absent";
}

async function storageAbsence(storage: AiUsageAudioStorage, objectKey: string): Promise<"absent" | "present" | "unknown"> {
  try {
    await storage.remove(objectKey);
  } catch {
    // A failed removal does not establish that the object is gone.
  }
  try {
    const check = await storage.download(objectKey);
    if (check.ok) return "present";
    if (check.notFound) return "absent";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function recoverUnregisteredUploads(
  deps: AiUsageAudioDeps,
  now: Date,
): Promise<{ recovered: number; acknowledged: number; deferred: number }> {
  let recovered = 0;
  let acknowledged = 0;
  let deferred = 0;
  const listed = await deps.storage.list("audio");
  if (!listed.ok) return { recovered, acknowledged, deferred: deferred + 1 };
  for (const object of listed.objects) {
    if (!RANDOM_OBJECT_KEY.test(object.key) || !isOlderThanGrace(object.createdAt, now)) continue;
    const presence = await audioPresence(deps, object.key);
    if (presence === "unknown") {
      deferred += 1;
      continue;
    }
    if (presence !== "missing") continue;
    const replay = recoveryMetadata(object.metadata);
    if (replay) {
      const confirmed = await confirmUploadedObject(deps, { objectKey: object.key, ...replay });
      if (confirmed === "committed") {
        recovered += 1;
        continue;
      }
      if (confirmed === "unknown") {
        deferred += 1;
        continue;
      }
      if (confirmed === "orphan") {
        const removed = await removeOnlyThisObject(deps.storage, object.key);
        if (removed && (await acknowledgeCleanup(deps, object.key))) acknowledged += 1;
        else deferred += 1;
        continue;
      }
    }
    const stillMissing = await audioPresence(deps, object.key);
    if (stillMissing !== "missing") continue;
    const removed = await removeOnlyThisObject(deps.storage, object.key);
    if (!removed) deferred += 1;
  }
  return { recovered, acknowledged, deferred };
}

function emptyCleanup(message: string): CleanupAiUsageAudioResult {
  return {
    ok: false,
    marked: 0,
    listed: 0,
    acknowledged: 0,
    retry: 0,
    skipped: 0,
    recovered: 0,
    untrackedDeferred: 0,
    message,
  };
}

async function audioPresence(
  deps: AiUsageAudioDeps,
  objectKey: string,
): Promise<"missing" | "committed" | "pending" | "cleanup" | "deleted" | "registered" | "unknown"> {
  const call = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.describeAudio, { p_object_key: objectKey });
  if (call.error || !call.rows[0]) return "unknown";
  const presence = call.rows[0].result_presence;
  if (
    presence === "missing" ||
    presence === "committed" ||
    presence === "pending" ||
    presence === "cleanup" ||
    presence === "deleted" ||
    presence === "registered"
  ) {
    return presence;
  }
  return "unknown";
}

function recoveryMetadata(metadata: Record<string, string>): {
  attemptId: string;
  acquisitionToken: string;
  byteLength: number;
  contentType: string;
  expiresAt: string;
} | null {
  const attemptId = metadata.attempt_id ?? "";
  const acquisitionToken = metadata.acquisition_token ?? "";
  const contentType = (metadata.content_type ?? "").trim().toLowerCase();
  const expiresAt = metadata.expires_at ?? "";
  const byteLength = Number(metadata.byte_length);
  if (!UUID_PATTERN.test(attemptId) || !UUID_PATTERN.test(acquisitionToken)) return null;
  if (!isAllowedContentType(contentType)) return null;
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > AI_USAGE_TTS_AUDIO_MAX_BYTES) return null;
  if (Number.isNaN(new Date(expiresAt).getTime())) return null;
  return { attemptId, acquisitionToken, byteLength, contentType, expiresAt };
}

async function acknowledgeCleanup(deps: AiUsageAudioDeps, objectKey: string): Promise<boolean> {
  const ack = await rpcRows(deps.rpc, AI_USAGE_METER_RPC.acknowledgeAudioCleanup, { p_object_key: objectKey });
  return !ack.error && asBool(ack.rows[0]?.result_acknowledged);
}

function isOlderThanGrace(createdAt: string, now: Date): boolean {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return created.getTime() <= now.getTime() - AI_USAGE_AUDIO_UNREGISTERED_GRACE_MS;
}

function stringMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number") metadata[key] = String(entry);
  }
  return metadata;
}

async function rpcRows(
  admin: AiUsageMeterRpcClient,
  fn: string,
  args: Record<string, string | number | boolean | null>,
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) return { rows: [], error: error.message };
  return { rows: asRows(data), error: null };
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  }
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  return [];
}

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function numberField(row: Record<string, unknown> | undefined, name: string): number {
  const value = row?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeBatchLimit(limit: number | undefined): number {
  if (limit == null) return AI_USAGE_AUDIO_CLEANUP_BATCH;
  if (!Number.isInteger(limit) || limit < 1) return 1;
  return Math.min(limit, 200);
}

function isAllowedContentType(value: string): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[start + index] ?? 0);
  return out;
}

function isExplicitlyMissing(message: string, statusCode?: string | number): boolean {
  const code = statusCode == null || statusCode === "" ? "" : String(statusCode);
  if (code === "404") return true;
  if (code !== "") return false;
  return /^(object )?not found\.?$/i.test(message.trim()) || /does not exist/i.test(message);
}

function isAlreadyExists(message: string, statusCode?: string | number): boolean {
  const code = statusCode == null ? "" : String(statusCode);
  return code === "409" || /already exists|duplicate/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "storage request failed";
}
