import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_USAGE_AUDIO_CLEANUP_BATCH,
  AI_USAGE_TTS_AUDIO_MAX_BYTES,
  aiUsageTtsAudioExpiresAt,
  aiUsageTtsAudioRetentionHours,
  cleanupAiUsageAudioBatch,
  createAiUsageAudioStorage,
  isCompleteAiUsageAudio,
  newAiUsageAudioObjectKey,
  readAiUsageReplayAudio,
  storeAiUsageAttemptAudio,
  type AiUsageAudioStorage,
} from "./ai-usage-audio";
import { AI_USAGE_AUDIO_BUCKET, AI_USAGE_METER_RPC, type AiUsageMeterRpcClient } from "./ai-usage-meter";

const root = process.cwd();
const attemptId = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const otherKey = "audio/33333333-3333-4333-8333-333333333333";
const now = new Date("2026-09-28T16:00:00.000Z");
const requestExpiry = "2026-09-29T16:00:00.000Z";

function wav(extra = 4): Uint8Array {
  const bytes = new Uint8Array(12 + extra);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 0);
  return bytes;
}

function mpeg(): Uint8Array {
  return Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
}

type RpcHandler = (fn: string, args: Record<string, string | number | boolean | null>) => {
  data: unknown;
  error: { message: string } | null;
};

function rpcClient(handler: RpcHandler): { client: AiUsageMeterRpcClient; calls: Array<{ fn: string; args: Record<string, string | number | boolean | null> }> } {
  const calls: Array<{ fn: string; args: Record<string, string | number | boolean | null> }> = [];
  return {
    calls,
    client: {
      rpc(fn, args) {
        calls.push({ fn, args });
        return Promise.resolve(handler(fn, args));
      },
    },
  };
}

function memoryStorage(seed: Record<string, Uint8Array> = {}): AiUsageAudioStorage & {
  objects: Map<string, Uint8Array>;
  uploads: Array<{ key: string; bytes: Uint8Array; contentType: string; metadata: Record<string, string> }>;
  removes: string[];
  downloads: string[];
  failUploads: number;
  failRemoves: number;
  failDownloads: number;
  failList: number;
  forceReadFailure: number;
  existOnUpload: Set<string>;
  createdAt: Map<string, string>;
  metadata: Map<string, Record<string, string>>;
} {
  const objects = new Map(Object.entries(seed));
  const store = {
    objects,
    uploads: [] as Array<{ key: string; bytes: Uint8Array; contentType: string; metadata: Record<string, string> }>,
    removes: [] as string[],
    downloads: [] as string[],
    failUploads: 0,
    failRemoves: 0,
    failDownloads: 0,
    failList: 0,
    forceReadFailure: 0,
    existOnUpload: new Set<string>(),
    createdAt: new Map<string, string>(),
    metadata: new Map<string, Record<string, string>>(),
    async upload(objectKey: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string>) {
      store.uploads.push({ key: objectKey, bytes, contentType, metadata });
      if (store.failUploads > 0) {
        store.failUploads -= 1;
        return { ok: false as const, alreadyExists: false, message: "upload timeout" };
      }
      if (store.existOnUpload.has(objectKey) || objects.has(objectKey)) {
        return { ok: false as const, alreadyExists: true, message: "The resource already exists" };
      }
      objects.set(objectKey, bytes);
      store.metadata.set(objectKey, metadata);
      return { ok: true as const };
    },
    async download(objectKey: string) {
      store.downloads.push(objectKey);
      if (store.forceReadFailure > 0) {
        store.forceReadFailure -= 1;
        return { ok: false as const, notFound: false, message: "storage read failed" };
      }
      if (store.failDownloads > 0) {
        store.failDownloads -= 1;
        return { ok: false as const, notFound: false, message: "download timeout" };
      }
      const bytes = objects.get(objectKey);
      if (!bytes) return { ok: false as const, notFound: true, message: "object not found" };
      return { ok: true as const, bytes };
    },
    async remove(objectKey: string) {
      store.removes.push(objectKey);
      if (store.failRemoves > 0) {
        store.failRemoves -= 1;
        throw new Error("storage remove failed");
      }
      const existed = objects.delete(objectKey);
      if (!existed) return { ok: false as const, notFound: true, message: "object not found" };
      return { ok: true as const };
    },
    async list() {
      if (store.failList > 0) {
        store.failList -= 1;
        return { ok: false as const, message: "list failed" };
      }
      return {
        ok: true as const,
        objects: [...objects.keys()].map((key) => ({
          key,
          createdAt: store.createdAt.get(key) ?? "",
          metadata: store.metadata.get(key) ?? {},
        })),
      };
    },
  };
  return store;
}

async function testRetention() {
  const request = new Date("2026-09-28T20:00:00.000Z");
  const capped = aiUsageTtsAudioExpiresAt(now, new Date("2026-09-30T16:00:00.000Z"), 24);
  assert.equal(capped.toISOString(), "2026-09-29T16:00:00.000Z");
  assert.equal(aiUsageTtsAudioExpiresAt(now, request, 24).toISOString(), request.toISOString());
  assert.equal(aiUsageTtsAudioRetentionHours(""), 24);
  assert.equal(aiUsageTtsAudioRetentionHours("48"), 48);
  assert.equal(aiUsageTtsAudioRetentionHours("0"), 24);
  assert.equal(aiUsageTtsAudioRetentionHours("999"), 24);
}

async function testSaveAndRecover() {
  const storage = memoryStorage();
  const spoken = "the guest asked for a late checkout";
  const key = "audio/44444444-4444-4444-8444-444444444444";
  const audio = wav();
  const { client, calls } = rpcClient((fn) => {
    if (fn === AI_USAGE_METER_RPC.commitAudio) {
      return { data: [{ result_committed: true, result_orphan: false }], error: null };
    }
    if (fn === AI_USAGE_METER_RPC.replay) {
      return {
        data: [{ result_status: "ready", result_object_key: key, result_byte_length: audio.byteLength, result_content_type: "audio/wav" }],
        error: null,
      };
    }
    return { data: [], error: { message: "unexpected rpc" } };
  });
  const stored = await storeAiUsageAttemptAudio(
    { rpc: client, storage, now: () => now, newObjectKey: () => key },
    { attemptId, acquisitionToken: token, bytes: audio, contentType: "audio/wav", requestExpiresAt: requestExpiry },
  );
  assert.equal(stored.ok, true);
  if (!stored.ok) return;
  assert.equal(stored.objectKey, key);
  assert.equal(stored.byteLength, audio.byteLength);
  assert.equal(stored.expiresAt, "2026-09-29T16:00:00.000Z");
  assert.equal(key.includes(spoken), false);
  assert.equal(key.includes(attemptId), false);
  assert.equal(key.includes(token), false);
  assert.equal(calls.filter((call) => call.fn === AI_USAGE_METER_RPC.commitAudio).length, 1);
  const commit = calls[0];
  assert.equal(commit.args.p_object_key, key);
  assert.equal(commit.args.p_byte_length, audio.byteLength);
  assert.equal(commit.args.p_acquisition_token, token);

  const read = await readAiUsageReplayAudio(
    { rpc: client, storage },
    { clientUsageKey: "stay-key", billingSubject: "stay:1" },
  );
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(read.bytes, audio);
  assert.equal(read.contentType, "audio/wav");
}

async function testRejectsIncompleteOrExpiredBeforeUpload() {
  const storage = memoryStorage({ [otherKey]: wav() });
  const { client, calls } = rpcClient(() => ({ data: [], error: { message: "should not be called" } }));
  const cases = [
    { bytes: Uint8Array.from([1, 2, 3]), contentType: "audio/mpeg", requestExpiresAt: requestExpiry },
    { bytes: wav(AI_USAGE_TTS_AUDIO_MAX_BYTES), contentType: "audio/wav", requestExpiresAt: requestExpiry },
    { bytes: wav(), contentType: "text/plain", requestExpiresAt: requestExpiry },
    { bytes: mpeg(), contentType: "audio/mpeg", requestExpiresAt: "2026-09-28T15:00:00.000Z" },
    { bytes: wav(), contentType: "audio/wav", requestExpiresAt: requestExpiry, attemptId: "not-a-uuid" },
  ];
  for (const input of cases) {
    const result = await storeAiUsageAttemptAudio(
      { rpc: client, storage, now: () => now, newObjectKey: () => "audio/55555555-5555-4555-8555-555555555555" },
      { attemptId, acquisitionToken: token, ...input },
    );
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.reason, "invalid");
  }
  assert.equal(storage.uploads.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(storage.objects.has(otherKey), true);
  assert.equal(isCompleteAiUsageAudio("audio/pcm", Uint8Array.from([9, 8, 7])), true);
  assert.equal(isCompleteAiUsageAudio("audio/mpeg", Uint8Array.from([0xff, 0xfb, 0x90])), true);
}

async function testUploadFailureDoesNotConfirm() {
  const storage = memoryStorage({ [otherKey]: wav() });
  storage.failUploads = 1;
  const { client, calls } = rpcClient(() => ({ data: [{ result_committed: true, result_orphan: false }], error: null }));
  const result = await storeAiUsageAttemptAudio(
    { rpc: client, storage, now: () => now, newObjectKey: () => "audio/66666666-6666-4666-8666-666666666666" },
    { attemptId, acquisitionToken: token, bytes: wav(), contentType: "audio/wav", requestExpiresAt: requestExpiry },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "upload_failed");
  assert.equal(calls.length, 0);
  assert.equal(storage.removes.length, 0);
  assert.equal(storage.objects.has(otherKey), true);
}

async function testExistingObjectIsNotOverwritten() {
  const existing = wav();
  const key = "audio/77777777-7777-4777-8777-777777777777";
  const storage = memoryStorage({ [key]: existing, [otherKey]: mpeg() });
  const { client, calls } = rpcClient(() => ({ data: [{ result_committed: true, result_orphan: false }], error: null }));
  const result = await storeAiUsageAttemptAudio(
    { rpc: client, storage, now: () => now, newObjectKey: () => key },
    { attemptId, acquisitionToken: token, bytes: mpeg(), contentType: "audio/mpeg", requestExpiresAt: requestExpiry },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "already_exists");
  assert.equal(calls.length, 0);
  assert.equal(storage.removes.length, 0);
  assert.deepEqual(storage.objects.get(key), existing);
  assert.equal(storage.objects.has(otherKey), true);
}

async function testLeaseLossLeavesForeignAudio() {
  const storage = memoryStorage({ [otherKey]: wav() });
  const key = "audio/88888888-8888-4888-8888-888888888888";
  const { client } = rpcClient((fn) => {
    assert.equal(fn, AI_USAGE_METER_RPC.commitAudio);
    return { data: [{ result_committed: false, result_orphan: true }], error: null };
  });
  const result = await storeAiUsageAttemptAudio(
    { rpc: client, storage, now: () => now, newObjectKey: () => key },
    { attemptId, acquisitionToken: token, bytes: mpeg(), contentType: "audio/mpeg", requestExpiresAt: requestExpiry },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "orphan_registered");
  assert.equal(result.objectKey, key);
  assert.equal(storage.removes.length, 0);
  assert.equal(storage.objects.has(key), true);
  assert.equal(storage.objects.has(otherKey), true);
}

async function testRefusedConfirmationRemovesOnlyTheNewObject() {
  const storage = memoryStorage({ [otherKey]: wav() });
  const key = "audio/99999999-9999-4999-8999-999999999999";
  const { client } = rpcClient(() => ({ data: [{ result_committed: false, result_orphan: false }], error: null }));
  const result = await storeAiUsageAttemptAudio(
    { rpc: client, storage, now: () => now, newObjectKey: () => key },
    { attemptId, acquisitionToken: token, bytes: wav(), contentType: "audio/wav", requestExpiresAt: requestExpiry },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "orphan_removed");
  assert.deepEqual(storage.removes, [key]);
  assert.equal(storage.objects.has(key), false);
  assert.equal(storage.objects.has(otherKey), true);
}

async function testOrphanRemoveFailureRetriesWithoutTouchingOtherAudio() {
  const storage = memoryStorage({ [otherKey]: wav() });
  const key = "audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  storage.failRemoves = 2;
  const { client } = rpcClient(() => ({ data: [{ result_committed: "f", result_orphan: "f" }], error: null }));
  const result = await storeAiUsageAttemptAudio(
    { rpc: client, storage, now: () => now, newObjectKey: () => key },
    { attemptId, acquisitionToken: token, bytes: wav(), contentType: "audio/wav", requestExpiresAt: requestExpiry },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "orphan_remove_failed");
  assert.equal(storage.objects.has(key), true);
  assert.equal(storage.objects.has(otherKey), true);
  assert.equal(storage.removes.includes(otherKey), false);
}

async function testExpiredReplayDoesNotDownload() {
  const storage = memoryStorage({ [otherKey]: wav() });
  const { client } = rpcClient(() => ({
    data: [{ result_status: "unavailable", result_object_key: null, result_byte_length: null, result_content_type: null }],
    error: null,
  }));
  const read = await readAiUsageReplayAudio(
    { rpc: client, storage },
    { clientUsageKey: "expired-key", billingSubject: "stay:1" },
  );
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.reason, "unavailable");
  assert.equal(storage.downloads.length, 0);
  assert.equal(storage.objects.has(otherKey), true);
}

async function testShortDownloadIsNotReturned() {
  const key = "audio/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const storage = memoryStorage({ [key]: wav(1) });
  const { client } = rpcClient(() => ({
    data: [{ result_status: "ready", result_object_key: key, result_byte_length: 40, result_content_type: "audio/wav" }],
    error: null,
  }));
  const read = await readAiUsageReplayAudio(
    { rpc: client, storage },
    { clientUsageKey: "stay-key", billingSubject: "stay:1" },
  );
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.reason, "incomplete");
  assert.equal("bytes" in read, false);
}

async function testCleanupRetriesUntilStorageConfirmsAbsence() {
  const first = "audio/cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const second = "audio/dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const unsafe = "../private/note";
  const storage = memoryStorage({
    [first]: wav(),
    [second]: mpeg(),
    [otherKey]: wav(),
  });
  storage.failRemoves = 1;
  storage.failDownloads = 1;
  const acknowledged: string[] = [];
  const { client, calls } = rpcClient((fn, args) => {
    if (fn === AI_USAGE_METER_RPC.markAudioCleanup) return { data: [{ result_marked: 2 }], error: null };
    if (fn === AI_USAGE_METER_RPC.listAudioCleanup) {
      return {
        data: [first, unsafe, second]
          .filter((objectKey) => objectKey === unsafe || !acknowledged.includes(objectKey))
          .map((objectKey) => ({
            result_object_key: objectKey,
            result_commit_state: objectKey === first ? "expired" : "orphan",
            result_expires_at: "2026-09-28T15:00:00.000Z",
          })),
        error: null,
      };
    }
    if (fn === AI_USAGE_METER_RPC.acknowledgeAudioCleanup) {
      acknowledged.push(String(args.p_object_key));
      return { data: [{ result_acknowledged: true }], error: null };
    }
    return { data: [], error: { message: "unexpected rpc" } };
  });

  const firstPass = await cleanupAiUsageAudioBatch(
    { rpc: client, storage },
    { now: "2026-09-28T16:00:00.000Z", limit: AI_USAGE_AUDIO_CLEANUP_BATCH },
  );
  assert.equal(firstPass.ok, true);
  assert.equal(firstPass.marked, 2);
  assert.equal(firstPass.acknowledged, 1);
  assert.equal(firstPass.retry, 1);
  assert.equal(firstPass.skipped, 1);
  assert.deepEqual(acknowledged, [second]);
  assert.equal(storage.objects.has(first), true);
  assert.equal(storage.objects.has(second), false);
  assert.equal(storage.objects.has(otherKey), true);
  assert.equal(calls.some((call) => call.fn === AI_USAGE_METER_RPC.markAudioCleanup && call.args.p_now === "2026-09-28T16:00:00.000Z"), true);

  const secondPass = await cleanupAiUsageAudioBatch({ rpc: client, storage });
  assert.equal(secondPass.acknowledged, 1);
  assert.equal(secondPass.skipped, 1);
  assert.equal(secondPass.retry, 0);
  assert.deepEqual(acknowledged, [second, first]);
  assert.equal(storage.objects.has(first), false);
  assert.equal(storage.objects.has(otherKey), true);
  assert.equal(storage.removes.includes(otherKey), false);
  assert.equal(storage.removes.includes(unsafe), false);
}

async function testCleanupDoesNotAcknowledgeWhenStorageStaysDown() {
  const key = "audio/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const storage = memoryStorage({ [key]: wav() });
  storage.failRemoves = 5;
  storage.failDownloads = 5;
  const { client, calls } = rpcClient((fn) => {
    if (fn === AI_USAGE_METER_RPC.markAudioCleanup) return { data: [{ result_marked: 1 }], error: null };
    if (fn === AI_USAGE_METER_RPC.listAudioCleanup) {
      return { data: [{ result_object_key: key, result_commit_state: "expired", result_expires_at: requestExpiry }], error: null };
    }
    return { data: [{ result_acknowledged: true }], error: null };
  });
  const result = await cleanupAiUsageAudioBatch({ rpc: client, storage });
  assert.equal(result.retry, 1);
  assert.equal(result.acknowledged, 0);
  assert.equal(calls.some((call) => call.fn === AI_USAGE_METER_RPC.acknowledgeAudioCleanup), false);
  assert.equal(storage.objects.has(key), true);
}

async function testMissingObjectCanBeAcknowledged() {
  const key = "audio/ffffffff-ffff-4fff-8fff-ffffffffffff";
  const storage = memoryStorage();
  const { client } = rpcClient((fn, args) => {
    if (fn === AI_USAGE_METER_RPC.markAudioCleanup) return { data: [{ result_marked: 0 }], error: null };
    if (fn === AI_USAGE_METER_RPC.listAudioCleanup) {
      return { data: [{ result_object_key: key, result_commit_state: "orphan", result_expires_at: requestExpiry }], error: null };
    }
    assert.equal(args.p_object_key, key);
    return { data: [{ result_acknowledged: true }], error: null };
  });
  const result = await cleanupAiUsageAudioBatch({ rpc: client, storage }, { limit: 10 });
  assert.equal(result.acknowledged, 1);
  assert.equal(result.retry, 0);
}

async function testAdapterDoesNotOverwriteOrSign() {
  const uploads: Array<{ path: string; options?: { upsert?: boolean; contentType?: string; cacheControl?: string } }> = [];
  const buckets: string[] = [];
  const storage = createAiUsageAudioStorage((bucket) => {
    buckets.push(bucket);
    return {
      async upload(path, _body, options) {
        uploads.push({ path, options });
        return { error: { message: "The resource already exists", statusCode: 409 } };
      },
      async download() {
        return { data: null, error: { message: "Object not found", statusCode: "404" } };
      },
      async remove() {
        return { data: null, error: null };
      },
      async list() {
        return { data: [], error: null };
      },
    };
  });
  const uploaded = await storage.upload("audio/12121212-1212-4121-8121-121212121212", wav(), "audio/wav", {});
  assert.equal(uploaded.ok, false);
  if (uploaded.ok) return;
  assert.equal(uploaded.alreadyExists, true);
  assert.equal(uploads[0]?.options?.upsert, false);
  assert.equal(uploads[0]?.options?.contentType, "audio/wav");
  const downloaded = await storage.download("audio/12121212-1212-4121-8121-121212121212");
  assert.equal(downloaded.ok, false);
  if (downloaded.ok) return;
  assert.equal(downloaded.notFound, true);
  const source = readFileSync(join(root, "src/lib/ai-usage-audio.ts"), "utf8");
  assert.equal(source.includes("createSignedUrl"), false);
  assert.equal(source.includes("getPublicUrl"), false);
  assert.equal(source.includes("storage.objects"), false);
  assert.equal(source.includes("AI_USAGE_AUDIO_BUCKET"), true);
  assert.deepEqual(buckets, [AI_USAGE_AUDIO_BUCKET]);
  assert.equal(AI_USAGE_AUDIO_BUCKET, "ai-usage-tts-audio");
}

async function testSchedulerStaysOffAndRoutesStayDisconnected() {
  const route = readFileSync(join(root, "src/app/api/cron/ai-usage-tts-audio-cleanup/route.ts"), "utf8");
  const example = readFileSync(join(root, "deploy/vercel.crons.ai-usage-tts-audio.example.json"), "utf8");
  const sql = readFileSync(join(root, "supabase/migrations/20260928190000_ai_usage_tts_audio_bucket.sql"), "utf8");
  assert.equal(route.includes("CRON_SECRET"), true);
  assert.equal(route.includes("status: 503"), true);
  assert.equal(route.includes("status: 401"), true);
  assert.equal(route.includes("Scheduler OFF"), true);
  assert.equal(route.includes("createSignedUrl"), false);
  assert.equal(route.includes("getPublicUrl"), false);
  assert.equal(example.includes("/api/cron/ai-usage-tts-audio-cleanup"), true);
  assert.equal(example.includes("*/15 * * * *"), true);
  assert.equal(existsSync(join(root, "vercel.json")), false);
  assert.equal(sql.trimStart().startsWith("--"), true);
  assert.match(sql, /public\s*=\s*false|false,/);
  assert.equal(/create\s+policy/i.test(sql), false);
  assert.equal(/delete\s+from\s+storage\.objects/i.test(sql), false);
  assert.equal(sql.includes("ai-usage-tts-audio"), true);
  assert.equal(sql.includes("5242880"), true);
  for (const relative of [
    "src/app/api/guest/stay-tts/route.ts",
    "src/app/api/guest/stay-welcome-tts/route.ts",
    "src/lib/guest-stay-tts.ts",
    "src/lib/guest-stay-welcome.ts",
    "src/lib/tts-synthesize.ts",
    "src/app/(founder-admin)/backoffice/isabela-usage/page.tsx",
  ]) {
    const source = readFileSync(join(root, relative), "utf8");
    assert.equal(source.includes("ai-usage-audio"), false, relative);
    assert.equal(source.includes("ai-usage-meter"), false, relative);
  }
  const key = newAiUsageAudioObjectKey(() => "abababab-abab-4bab-8bab-abababababab");
  assert.equal(key, "audio/abababab-abab-4bab-8bab-abababababab");
}

async function testConfirmationErrorDoesNotTouchOtherAudio() {
  const storage = memoryStorage({ [otherKey]: wav() });
  const key = "audio/12121212-1212-4121-8121-121212121212";
  let attempts = 0;
  const { client } = rpcClient(() => {
    attempts += 1;
    return { data: null, error: { message: "rpc timeout" } };
  });
  const unknown = await storeAiUsageAttemptAudio(
    { rpc: client, storage, now: () => now, newObjectKey: () => key },
    { attemptId, acquisitionToken: token, bytes: wav(), contentType: "audio/wav", requestExpiresAt: requestExpiry },
  );
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.reason, "confirmation_unknown");
  assert.equal(attempts, 2);
  assert.equal(storage.removes.length, 0);
  assert.equal(storage.objects.has(key), true);
  assert.equal(storage.objects.has(otherKey), true);

  const retryKey = "audio/13131313-1313-4131-8131-131313131313";
  let retryAttempts = 0;
  const retry = rpcClient(() => {
    retryAttempts += 1;
    if (retryAttempts === 1) return { data: null, error: { message: "rpc timeout" } };
    return { data: [{ result_committed: true, result_orphan: false }], error: null };
  });
  const stored = await storeAiUsageAttemptAudio(
    { rpc: retry.client, storage, now: () => now, newObjectKey: () => retryKey },
    { attemptId, acquisitionToken: token, bytes: mpeg(), contentType: "audio/mpeg", requestExpiresAt: requestExpiry },
  );
  assert.equal(stored.ok, true);
  assert.equal(retryAttempts, 2);
  assert.equal(storage.objects.has(otherKey), true);
}

async function testFailedStorageReadIsNotMissing() {
  const reads = [
    { data: null, error: null },
    { data: null, error: { message: "Object not found", statusCode: 500 } },
    { data: null, error: { message: "storage read failed", statusCode: "" } },
  ];
  for (const read of reads) {
    const storage = createAiUsageAudioStorage(() => ({
      async upload() {
        return { error: null };
      },
      async download() {
        return read;
      },
      async remove() {
        return { data: null, error: null };
      },
      async list() {
        return { data: [], error: null };
      },
    }));
    const downloaded = await storage.download("audio/17171717-1717-4171-8171-171717171717");
    assert.equal(downloaded.ok, false);
    if (downloaded.ok) continue;
    assert.equal(downloaded.notFound, false);
  }

  const key = "audio/18181818-1818-4181-8181-181818181818";
  const storage = memoryStorage({ [key]: wav(), [otherKey]: mpeg() });
  storage.forceReadFailure = 1;
  const { client, calls } = rpcClient((fn) => {
    if (fn === AI_USAGE_METER_RPC.markAudioCleanup) return { data: [{ result_marked: 1 }], error: null };
    if (fn === AI_USAGE_METER_RPC.listAudioCleanup) {
      return { data: [{ result_object_key: key, result_commit_state: "expired", result_expires_at: requestExpiry }], error: null };
    }
    return { data: [{ result_acknowledged: true }], error: null };
  });
  const result = await cleanupAiUsageAudioBatch({ rpc: client, storage, now: () => now });
  assert.equal(result.acknowledged, 0);
  assert.equal(result.retry, 1);
  assert.equal(calls.some((call) => call.fn === AI_USAGE_METER_RPC.acknowledgeAudioCleanup), false);
  assert.equal(storage.removes.includes(otherKey), false);
}

async function testCleanupRecoversUnregisteredUpload() {
  const lostKey = "audio/19191919-1919-4191-8191-191919191919";
  const youngKey = "audio/1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a";
  const pendingKey = "audio/1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b";
  const spoken = "the guest asked for a late checkout";
  const audio = wav();
  let storeCommits = 0;
  const failing = rpcClient(() => {
    storeCommits += 1;
    return { data: null, error: { message: "rpc timeout" } };
  });
  const storage = memoryStorage({ [otherKey]: mpeg(), [youngKey]: wav(), [pendingKey]: wav() });
  storage.createdAt.set(otherKey, "2026-09-28T14:00:00.000Z");
  storage.createdAt.set(youngKey, "2026-09-28T15:59:00.000Z");
  storage.createdAt.set(pendingKey, "2026-09-28T15:30:00.000Z");
  const stored = await storeAiUsageAttemptAudio(
    { rpc: failing.client, storage, now: () => now, newObjectKey: () => lostKey },
    { attemptId, acquisitionToken: token, bytes: audio, contentType: "audio/wav", requestExpiresAt: requestExpiry },
  );
  assert.equal(stored.ok, false);
  if (stored.ok) return;
  assert.equal(stored.reason, "confirmation_unknown");
  assert.equal(storeCommits, 2);
  assert.equal(storage.objects.has(lostKey), true);
  assert.equal(storage.removes.length, 0);
  const saved = storage.metadata.get(lostKey);
  assert.equal(saved?.attempt_id, attemptId);
  assert.equal(saved?.acquisition_token, token);
  assert.equal(saved?.byte_length, String(audio.byteLength));
  assert.equal(JSON.stringify(saved).includes(spoken), false);
  storage.createdAt.set(lostKey, "2026-09-28T15:40:00.000Z");

  const described: string[] = [];
  let recoveryCommits = 0;
  const recovering = rpcClient((fn, args) => {
    if (fn === AI_USAGE_METER_RPC.markAudioCleanup) return { data: [{ result_marked: 0 }], error: null };
    if (fn === AI_USAGE_METER_RPC.listAudioCleanup) return { data: [], error: null };
    if (fn === AI_USAGE_METER_RPC.describeAudio) {
      described.push(String(args.p_object_key));
      if (args.p_object_key === otherKey) return { data: [{ result_presence: "committed" }], error: null };
      if (args.p_object_key === pendingKey) return { data: [{ result_presence: "pending" }], error: null };
      return { data: [{ result_presence: "missing" }], error: null };
    }
    if (fn === AI_USAGE_METER_RPC.commitAudio) {
      recoveryCommits += 1;
      assert.equal(args.p_object_key, lostKey);
      assert.equal(args.p_attempt_id, attemptId);
      assert.equal(args.p_acquisition_token, token);
      assert.equal(args.p_byte_length, audio.byteLength);
      return { data: [{ result_committed: true, result_orphan: false }], error: null };
    }
    return { data: [{ result_acknowledged: true }], error: null };
  });
  const recovered = await cleanupAiUsageAudioBatch({ rpc: recovering.client, storage, now: () => now });
  assert.equal(recovered.recovered, 1);
  assert.equal(recoveryCommits, 1);
  assert.equal(described.includes(youngKey), false);
  assert.equal(described.includes(lostKey), true);
  assert.equal(described.includes(otherKey), true);
  assert.equal(described.includes(pendingKey), true);
  assert.deepEqual(storage.removes, []);
  assert.equal(storage.objects.has(lostKey), true);
  assert.equal(storage.objects.has(otherKey), true);
  assert.equal(storage.objects.has(youngKey), true);
  assert.equal(storage.objects.has(pendingKey), true);
}

async function testUnregisteredRecoveryDoesNotDeleteWhenCommitStillFails() {
  const lostKey = "audio/1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c";
  const audio = wav();
  const storage = memoryStorage({ [lostKey]: audio, [otherKey]: mpeg() });
  storage.createdAt.set(lostKey, "2026-09-28T15:00:00.000Z");
  storage.createdAt.set(otherKey, "2026-09-28T14:00:00.000Z");
  storage.metadata.set(lostKey, {
    attempt_id: attemptId,
    acquisition_token: token,
    byte_length: String(audio.byteLength),
    content_type: "audio/wav",
    expires_at: requestExpiry,
  });
  let commits = 0;
  const { client } = rpcClient((fn, args) => {
    if (fn === AI_USAGE_METER_RPC.markAudioCleanup) return { data: [{ result_marked: 0 }], error: null };
    if (fn === AI_USAGE_METER_RPC.listAudioCleanup) return { data: [], error: null };
    if (fn === AI_USAGE_METER_RPC.describeAudio) {
      if (args.p_object_key === otherKey) return { data: [{ result_presence: "committed" }], error: null };
      return { data: [{ result_presence: "missing" }], error: null };
    }
    commits += 1;
    return { data: null, error: { message: "rpc timeout" } };
  });
  const result = await cleanupAiUsageAudioBatch({ rpc: client, storage, now: () => now });
  assert.equal(commits, 2);
  assert.equal(result.recovered, 0);
  assert.equal(result.untrackedDeferred, 1);
  assert.deepEqual(storage.removes, []);
  assert.equal(storage.objects.has(lostKey), true);
  assert.equal(storage.objects.has(otherKey), true);
}

async function testLeaseLossDuringRecoveryDeletesOnlyTheUnregisteredObject() {
  const lostKey = "audio/1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d";
  const youngKey = "audio/1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e";
  const audio = mpeg();
  const storage = memoryStorage({ [lostKey]: audio, [otherKey]: wav(), [youngKey]: wav() });
  storage.createdAt.set(lostKey, "2026-09-28T15:00:00.000Z");
  storage.createdAt.set(otherKey, "2026-09-28T14:00:00.000Z");
  storage.createdAt.set(youngKey, "2026-09-28T15:59:30.000Z");
  storage.metadata.set(lostKey, {
    attempt_id: attemptId,
    acquisition_token: token,
    byte_length: String(audio.byteLength),
    content_type: "audio/mpeg",
    expires_at: requestExpiry,
  });
  const acknowledged: string[] = [];
  const { client } = rpcClient((fn, args) => {
    if (fn === AI_USAGE_METER_RPC.markAudioCleanup) return { data: [{ result_marked: 0 }], error: null };
    if (fn === AI_USAGE_METER_RPC.listAudioCleanup) return { data: [], error: null };
    if (fn === AI_USAGE_METER_RPC.describeAudio) {
      if (args.p_object_key === otherKey) return { data: [{ result_presence: "committed" }], error: null };
      return { data: [{ result_presence: "missing" }], error: null };
    }
    if (fn === AI_USAGE_METER_RPC.commitAudio) return { data: [{ result_committed: false, result_orphan: true }], error: null };
    acknowledged.push(String(args.p_object_key));
    return { data: [{ result_acknowledged: true }], error: null };
  });
  const result = await cleanupAiUsageAudioBatch({ rpc: client, storage, now: () => now });
  assert.equal(result.recovered, 0);
  assert.equal(result.acknowledged, 1);
  assert.deepEqual(acknowledged, [lostKey]);
  assert.equal(storage.objects.has(lostKey), false);
  assert.equal(storage.objects.has(otherKey), true);
  assert.equal(storage.objects.has(youngKey), true);
  assert.equal(storage.removes.includes(otherKey), false);
  assert.equal(storage.removes.includes(youngKey), false);
}

await testRetention();
await testSaveAndRecover();
await testRejectsIncompleteOrExpiredBeforeUpload();
await testUploadFailureDoesNotConfirm();
await testExistingObjectIsNotOverwritten();
await testLeaseLossLeavesForeignAudio();
await testRefusedConfirmationRemovesOnlyTheNewObject();
await testOrphanRemoveFailureRetriesWithoutTouchingOtherAudio();
await testConfirmationErrorDoesNotTouchOtherAudio();
await testExpiredReplayDoesNotDownload();
await testShortDownloadIsNotReturned();
await testCleanupRetriesUntilStorageConfirmsAbsence();
await testCleanupDoesNotAcknowledgeWhenStorageStaysDown();
await testMissingObjectCanBeAcknowledged();
await testAdapterDoesNotOverwriteOrSign();
await testFailedStorageReadIsNotMissing();
await testCleanupRecoversUnregisteredUpload();
await testUnregisteredRecoveryDoesNotDeleteWhenCommitStillFails();
await testLeaseLossDuringRecoveryDeletesOnlyTheUnregisteredObject();
await testSchedulerStaysOffAndRoutesStayDisconnected();
console.log("ai-usage audio storage tests passed");
