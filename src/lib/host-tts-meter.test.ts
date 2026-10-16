import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AI_USAGE_METER_RPC, type AiUsageMeterRpcClient } from "./ai-usage-meter";
import type { AiUsageAudioStorage } from "./ai-usage-audio";
import {
  aggregateAiUsageRows,
  applyHostTtsMeterHistory,
  mergeHostTtsMeterMonth,
  readHostTtsMeterMonth,
  type AiUsageMonthSnapshot,
} from "./ai-usage";
import { hostTtsMeterEnabled } from "./host-tts-meter-flag";
import {
  hostTtsBillingSubject,
  hostTtsSynthesisBinding,
  serveHostTtsMeter,
  type HostTtsProvider,
} from "./host-tts-meter";
import {
  beginHostTtsPlaybackAction,
  forgetHostTtsUsageKey,
  hostTtsUsageKeyForAction,
  rememberHostTtsUsageKey,
  resetHostTtsUsageKeyForTests,
} from "./host-tts-usage-key";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const USER_ID = "11111111-1111-4111-8111-111111111111";

function pcmTone(samples = 2400) {
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples; index += 1) {
    view.setInt16(index * 2, Math.round(Math.sin(index / 8) * 8000), true);
  }
  return bytes;
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function readBody(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value) chunks.push(next.value);
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

type RequestRow = {
  id: string;
  key: string;
  subject: string;
  hash: string;
  hostId: string;
  expiresAt: number;
  state: string;
  eligibility: string;
  token: string | null;
  leaseExpires: number | null;
  ordinal: number;
  activeKey: string | null;
};

type AttemptRow = {
  id: string;
  requestId: string;
  ordinal: number;
  progress: "reserved" | "dispatch_started" | "response_observed";
  result: "open" | "provider_complete" | "failed" | "uncertain";
  streamCompleted: boolean;
  audioBytes: number | null;
  delivery: "pending" | "stored";
  objectKey: string | null;
};

type ObjectRow = {
  key: string;
  attemptId: string;
  token: string;
  bytes: number;
  contentType: string;
  expiresAt: number;
  commit: "committed";
};

function createMeterDouble(clock: { ms: number }) {
  const requests: RequestRow[] = [];
  const attempts: AttemptRow[] = [];
  const objects: ObjectRow[] = [];
  const files = new Map<string, Uint8Array>();
  const trace: string[] = [];

  function requestByKey(key: string) {
    return requests.find((row) => row.key === key) ?? null;
  }
  function currentAttempt(request: RequestRow) {
    return attempts.find((row) => row.requestId === request.id && row.ordinal === request.ordinal) ?? null;
  }
  function leaseLive(request: RequestRow, token: string) {
    return request.token === token && request.leaseExpires != null && request.leaseExpires > clock.ms;
  }

  const rpc: AiUsageMeterRpcClient["rpc"] = (fn, args) => {
    trace.push(fn);
    const text = (name: string) => (typeof args[name] === "string" ? String(args[name]) : "");
    if (fn === AI_USAGE_METER_RPC.issue) {
      const key = randomUUID();
      const row: RequestRow = {
        id: randomUUID(),
        key,
        subject: text("p_billing_subject"),
        hash: text("p_synthesis_binding_hash"),
        hostId: text("p_host_id"),
        expiresAt: Date.parse(text("p_expires_at")),
        state: "issued",
        eligibility: "withheld",
        token: null,
        leaseExpires: null,
        ordinal: 0,
        activeKey: null,
      };
      requests.push(row);
      return Promise.resolve({
        data: [{ result_logical_request_id: row.id, result_client_usage_key: key, result_expires_at: text("p_expires_at") }],
        error: null,
      });
    }
    if (fn === AI_USAGE_METER_RPC.validate) {
      const request = requestByKey(text("p_client_usage_key"));
      if (!request) return Promise.resolve({ data: [{ result_ok: false, result_rejection_reason: "unknown" }], error: null });
      let reason: string | null = null;
      if (text("p_billing_subject") !== request.subject) reason = "subject_mismatch";
      else if (request.expiresAt <= clock.ms) reason = "expired";
      else if (text("p_source") !== "host_tts" || text("p_operation") !== "tts" || text("p_synthesis_binding_hash") !== request.hash) {
        reason = "binding_mismatch";
      }
      if (reason) return Promise.resolve({ data: [{ result_ok: false, result_rejection_reason: reason }], error: null });
      return Promise.resolve({ data: [{ result_ok: true, result_logical_request_id: request.id, result_rejection_reason: null }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.acquire) {
      const request = requestByKey(text("p_client_usage_key"));
      if (!request) {
        return Promise.resolve({ data: [{ result_outcome: "rejected", result_rejection_reason: "unknown" }], error: null });
      }
      if (text("p_billing_subject") !== request.subject) {
        return Promise.resolve({ data: [{ result_outcome: "rejected", result_rejection_reason: "subject_mismatch" }], error: null });
      }
      if (request.expiresAt <= clock.ms) {
        return Promise.resolve({ data: [{ result_outcome: "rejected", result_rejection_reason: "expired" }], error: null });
      }
      if (text("p_synthesis_binding_hash") !== request.hash) {
        return Promise.resolve({ data: [{ result_outcome: "rejected", result_rejection_reason: "binding_mismatch" }], error: null });
      }
      if (request.state === "completed") {
        return Promise.resolve({ data: [{ result_outcome: "completed", result_logical_request_id: request.id }], error: null });
      }
      if (request.state === "acquired" || request.state === "in_progress") {
        return Promise.resolve({ data: [{ result_outcome: "busy", result_logical_request_id: request.id }], error: null });
      }
      if ((request.state === "failed" || request.state === "uncertain") && args.p_allow_retry !== true) {
        return Promise.resolve({ data: [{ result_outcome: "not_retryable", result_logical_request_id: request.id }], error: null });
      }
      if (request.state !== "issued" && request.state !== "failed" && request.state !== "uncertain") {
        return Promise.resolve({ data: [{ result_outcome: "busy", result_logical_request_id: request.id }], error: null });
      }
      const seconds = typeof args.p_lease_seconds === "number" ? args.p_lease_seconds : 120;
      request.ordinal += 1;
      request.state = "acquired";
      request.token = randomUUID();
      request.leaseExpires = clock.ms + seconds * 1000;
      const attempt: AttemptRow = {
        id: randomUUID(),
        requestId: request.id,
        ordinal: request.ordinal,
        progress: "reserved",
        result: "open",
        streamCompleted: false,
        audioBytes: null,
        delivery: "pending",
        objectKey: null,
      };
      attempts.push(attempt);
      return Promise.resolve({
        data: [{
          result_outcome: "acquired",
          result_logical_request_id: request.id,
          result_attempt_id: attempt.id,
          result_attempt_ordinal: attempt.ordinal,
          result_acquisition_token: request.token,
          result_lease_expires_at: new Date(request.leaseExpires).toISOString(),
          result_rejection_reason: null,
        }],
        error: null,
      });
    }
    if (fn === AI_USAGE_METER_RPC.renew) {
      const request = requests.find((row) => row.id === text("p_logical_request_id")) ?? null;
      if (!request || !leaseLive(request, text("p_acquisition_token"))) {
        return Promise.resolve({ data: [{ result_renewed: false, result_lease_expires_at: null }], error: null });
      }
      const seconds = typeof args.p_lease_seconds === "number" ? args.p_lease_seconds : 120;
      request.leaseExpires = clock.ms + seconds * 1000;
      return Promise.resolve({ data: [{ result_renewed: true, result_lease_expires_at: new Date(request.leaseExpires).toISOString() }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.dispatchStarted) {
      const attempt = attempts.find((row) => row.id === text("p_attempt_id")) ?? null;
      const request = attempt ? requests.find((row) => row.id === attempt.requestId) ?? null : null;
      if (!attempt || !request || !leaseLive(request, text("p_acquisition_token")) || attempt.result !== "open" || attempt.progress !== "reserved") {
        return Promise.resolve({ data: [{ result_updated: false }], error: null });
      }
      attempt.progress = "dispatch_started";
      request.state = "in_progress";
      return Promise.resolve({ data: [{ result_updated: true }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.responseObserved) {
      const attempt = attempts.find((row) => row.id === text("p_attempt_id")) ?? null;
      const request = attempt ? requests.find((row) => row.id === attempt.requestId) ?? null : null;
      if (!attempt || !request || !leaseLive(request, text("p_acquisition_token")) || attempt.result !== "open") {
        return Promise.resolve({ data: [{ result_updated: false }], error: null });
      }
      attempt.progress = "response_observed";
      return Promise.resolve({ data: [{ result_updated: true }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.recordResult) {
      const attempt = attempts.find((row) => row.id === text("p_attempt_id")) ?? null;
      const request = attempt ? requests.find((row) => row.id === attempt.requestId) ?? null : null;
      if (!attempt || !request || !leaseLive(request, text("p_acquisition_token")) || attempt.result !== "open") {
        return Promise.resolve({ data: [{ result_recorded: false }], error: null });
      }
      const result = text("p_result_state");
      if (result === "provider_complete") {
        if (attempt.progress !== "response_observed" || args.p_stream_completed !== true || typeof args.p_audio_bytes !== "number" || args.p_audio_bytes <= 0) {
          return Promise.resolve({ data: [{ result_recorded: false }], error: null });
        }
      }
      attempt.result = result === "provider_complete" || result === "failed" || result === "uncertain" ? result : "failed";
      attempt.streamCompleted = args.p_stream_completed === true;
      attempt.audioBytes = typeof args.p_audio_bytes === "number" ? args.p_audio_bytes : null;
      return Promise.resolve({ data: [{ result_recorded: true }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.fallback) {
      const request = requests.find((row) => row.id === text("p_logical_request_id")) ?? null;
      const attempt = request ? currentAttempt(request) : null;
      if (!request || !attempt || !leaseLive(request, text("p_acquisition_token")) || request.state !== "in_progress" || attempt.result === "open") {
        return Promise.resolve({ data: [{ result_started: false }], error: null });
      }
      request.ordinal += 1;
      const next: AttemptRow = {
        id: randomUUID(),
        requestId: request.id,
        ordinal: request.ordinal,
        progress: "reserved",
        result: "open",
        streamCompleted: false,
        audioBytes: null,
        delivery: "pending",
        objectKey: null,
      };
      attempts.push(next);
      return Promise.resolve({ data: [{ result_started: true, result_attempt_id: next.id, result_attempt_ordinal: next.ordinal }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.commitAudio) {
      const attempt = attempts.find((row) => row.id === text("p_attempt_id")) ?? null;
      const request = attempt ? requests.find((row) => row.id === attempt.requestId) ?? null : null;
      if (!attempt || !request || !leaseLive(request, text("p_acquisition_token"))) {
        return Promise.resolve({ data: [{ result_committed: false, result_orphan: true }], error: null });
      }
      if (attempt.result !== "provider_complete" || attempt.audioBytes !== args.p_byte_length) {
        return Promise.resolve({ data: [{ result_committed: false, result_orphan: false }], error: null });
      }
      const object: ObjectRow = {
        key: text("p_object_key"),
        attemptId: attempt.id,
        token: text("p_acquisition_token"),
        bytes: Number(args.p_byte_length),
        contentType: text("p_content_type"),
        expiresAt: Date.parse(text("p_expires_at")),
        commit: "committed",
      };
      objects.push(object);
      attempt.delivery = "stored";
      attempt.objectKey = object.key;
      request.activeKey = object.key;
      return Promise.resolve({ data: [{ result_committed: true, result_orphan: false }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.close) {
      const request = requests.find((row) => row.id === text("p_logical_request_id")) ?? null;
      if (!request || !leaseLive(request, text("p_acquisition_token"))) {
        return Promise.resolve({ data: [{ result_outcome: "stale", result_state: null, result_billing_eligibility: null }], error: null });
      }
      const outcome = text("p_outcome");
      if (outcome === "completed") {
        const attempt = currentAttempt(request);
        const object = objects.find((row) => row.key === request.activeKey) ?? null;
        const audioOk = Boolean(
          attempt &&
            object &&
            attempt.result === "provider_complete" &&
            attempt.streamCompleted &&
            attempt.audioBytes === object.bytes &&
            attempt.delivery === "stored" &&
            object.commit === "committed" &&
            object.expiresAt > clock.ms,
        );
        if (!audioOk) {
          return Promise.resolve({ data: [{ result_outcome: "audio_absent", result_state: request.state, result_billing_eligibility: request.eligibility }], error: null });
        }
        request.state = "completed";
        request.eligibility = "withheld";
        request.token = null;
        request.leaseExpires = null;
        return Promise.resolve({ data: [{ result_outcome: "completed", result_state: "completed", result_billing_eligibility: "withheld" }], error: null });
      }
      request.state = outcome === "failed" ? "failed" : "uncertain";
      request.eligibility = "withheld";
      request.token = null;
      request.leaseExpires = null;
      return Promise.resolve({ data: [{ result_outcome: request.state, result_state: request.state, result_billing_eligibility: "withheld" }], error: null });
    }
    if (fn === AI_USAGE_METER_RPC.replay) {
      const request = requestByKey(text("p_client_usage_key"));
      if (!request || text("p_billing_subject") !== request.subject || request.expiresAt <= clock.ms || request.state !== "completed") {
        return Promise.resolve({ data: [{ result_status: "unavailable", result_object_key: null, result_byte_length: null, result_content_type: null }], error: null });
      }
      const object = objects.find((row) => row.key === request.activeKey) ?? null;
      if (!object || object.expiresAt <= clock.ms || object.bytes <= 0) {
        return Promise.resolve({ data: [{ result_status: "unavailable", result_object_key: null, result_byte_length: null, result_content_type: null }], error: null });
      }
      return Promise.resolve({
        data: [{ result_status: "ready", result_object_key: object.key, result_byte_length: object.bytes, result_content_type: object.contentType }],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
  };

  const storage: AiUsageAudioStorage = {
    async upload(objectKey, bytes) {
      if (files.has(objectKey)) return { ok: false, alreadyExists: true, message: "exists" };
      files.set(objectKey, Uint8Array.from(bytes));
      return { ok: true };
    },
    async download(objectKey) {
      const bytes = files.get(objectKey);
      if (!bytes) return { ok: false, notFound: true, message: "not found" };
      return { ok: true, bytes: Uint8Array.from(bytes) };
    },
    async remove(objectKey) {
      files.delete(objectKey);
      return { ok: true };
    },
    async list() {
      return { ok: true, objects: [] };
    },
  };

  return {
    rpc: { rpc },
    storage,
    trace,
    snapshot(key: string) {
      const request = requestByKey(key);
      return {
        state: request?.state ?? null,
        eligibility: request?.eligibility ?? null,
        attempts: attempts.filter((row) => row.requestId === request?.id).map((row) => row.result),
      };
    },
    requestCount() {
      return requests.length;
    },
  };
}

function providerOf(audio: Uint8Array, trace: string[], mode: "ok" | "fallback" | "partial" | "hold", hold?: Promise<void>): HostTtsProvider & { calls: number } {
  const provider = {
    calls: 0,
    async synthesize(input: { attempt: "primary" | "fallback" }) {
      provider.calls += 1;
      trace.push(`provider:${input.attempt}`);
      if (mode === "hold" && provider.calls === 1 && hold) await hold;
      if (mode === "fallback" && input.attempt === "primary") {
        return { ok: false as const, message: "primary pcm response was not usable" };
      }
      if (mode === "partial") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(audio.slice(0, 100));
            controller.error(new Error("truncated pcm"));
          },
        });
        return { ok: true as const, stream, contentType: "audio/pcm" as const, model: "gpt-4o-mini-tts", voice: "coral", language: "en" as const, sampleRate: 24000 };
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(audio);
          controller.close();
        },
      });
      return { ok: true as const, stream, contentType: "audio/pcm" as const, model: "gpt-4o-mini-tts", voice: "coral", language: "en" as const, sampleRate: 24000 };
    },
  };
  return provider;
}

async function play(options: {
  clock: { ms: number };
  meter: ReturnType<typeof createMeterDouble>;
  provider: HostTtsProvider;
  text?: string;
  usageKey?: string | null;
  requestTtlMs?: number;
}) {
  return serveHostTtsMeter({
    rpc: options.meter.rpc,
    storage: options.meter.storage,
    provider: options.provider,
    userId: USER_ID,
    usageKey: options.usageKey,
    text: options.text ?? "Hello from the studio.",
    voice: "coral",
    language: "en",
    speed: 1,
    now: () => new Date(options.clock.ms),
    requestTtlMs: options.requestTtlMs ?? 60_000,
  });
}

async function runHostTtsMeterTests() {
  assert(hostTtsMeterEnabled({}) === false, "host meter flag defaults off");
  assert(hostTtsMeterEnabled({ AI_USAGE_HOST_TTS_METER: "1" }) === true, "flag value 1 enables the host meter");
  assert(hostTtsMeterEnabled({ AI_USAGE_HOST_TTS_METER: "true" }) === false, "only 1 enables the host meter");
  const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  assert(example.includes("# AI_USAGE_HOST_TTS_METER=1"), "flag stays commented in the env example");
  assert(!/^AI_USAGE_HOST_TTS_METER=1$/m.test(example), "env example does not turn the flag on");
  assert(example.includes("zencierge-sandbox"), "first activation is documented for the sandbox");
  assert(example.includes("Do not set this in production."), "production activation is refused in the env example");

  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260928200000_host_tts_meter_backoffice_read.sql"), "utf8");
  const executableSql = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert(sql.trimStart().startsWith("--"), "backoffice read sql is commented");
  const charactersSql = executableSql.slice(executableSql.indexOf("coalesce(sum(a.input_characters)"));
  assert(charactersSql.includes("a.created_at >= p_from"), "characters use the attempt month");
  assert(!charactersSql.slice(0, charactersSql.indexOf("provider_complete")).includes("r.created_at"), "characters are not limited to the request month");
  assert(executableSql.includes("a.response_observed_at is not null"), "observed attempts keep a response timestamp");
  assert(executableSql.includes("source = 'host_tts'"), "backoffice read counts host_tts");
  assert(!/\b(from|into|update|delete\s+from)\s+public\.ai_usage_events\b/i.test(executableSql), "backoffice read does not touch historical events");
  assert(!/\b(insert|update|delete)\b/i.test(executableSql), "backoffice read does not write");
  assert(sql.includes("grant execute on function public.summarize_host_tts_meter_backoffice"), "service role can execute the read");
  const meterSource = readFileSync(join(process.cwd(), "src/lib/host-tts-meter.ts"), "utf8");
  assert(!meterSource.includes("recordAiUsageEvent") && !meterSource.includes("ai_usage_events"), "metered host TTS does not write usage events");
  const route = readFileSync(join(process.cwd(), "src/app/api/tts/route.ts"), "utf8");
  assert(route.includes("if (!hostTtsMeterEnabled())"), "route keeps the unmetered path behind the flag");
  assert(route.includes("postUnmeteredHostTts"), "unmetered playback remains");
  const client = readFileSync(join(process.cwd(), "src/lib/human-voice.ts"), "utf8");
  assert(client.includes("beginHostTtsPlaybackAction"), "a click starts a playback action");
  assert(client.includes("hostTtsUsageKeyForAction"), "a retry looks up the key for that action");
  assert(!client.includes("hostTtsPlaybackIdentity"), "the client key is not derived from the spoken text");
  assert(client.includes('Accept: "audio/pcm"'), "client still asks for PCM");
  assert(!client.includes("ai-usage-meter"), "client does not import the server meter");

  const audio = pcmTone();
  assert(audio.byteLength === 4800, "simulated pcm is a tenth of a second at 24 kHz");
  const clock = { ms: Date.parse("2026-09-28T19:00:00.000Z") };
  const meter = createMeterDouble(clock);
  const provider = providerOf(audio, meter.trace, "ok");
  const first = await play({ clock, meter, provider });
  assert(first.ok, "initial playback returns audio");
  if (!first.ok) return;
  const firstBytes = await readBody(first.stream);
  assert(sameBytes(firstBytes, audio), "initial playback bytes match the provider audio");
  assert(first.contentType === "audio/pcm", "playback stays PCM");
  assert(provider.calls === 1, "initial playback calls the provider once");
  const snap = meter.snapshot(first.usageKey);
  assert(snap.state === "completed", "complete audio closes the request");
  assert(snap.eligibility === "withheld", "host_tts stays withheld");
  assert(meter.trace.indexOf(AI_USAGE_METER_RPC.validate) < meter.trace.indexOf("provider:primary"), "validation happens before the provider");
  assert(meter.trace.indexOf(AI_USAGE_METER_RPC.renew) < meter.trace.indexOf("provider:primary"), "the lease is renewed before the provider");

  const retryProvider = providerOf(audio, meter.trace, "ok");
  const retry = await play({ clock, meter, provider: retryProvider, usageKey: first.usageKey });
  assert(retry.ok, "retry returns audio");
  if (!retry.ok) return;
  assert(retry.usageKey === first.usageKey, "retry reuses the issued key");
  const retryBytes = await readBody(retry.stream);
  assert(sameBytes(retryBytes, audio), "retry returns the stored pcm");
  assert(retryProvider.calls === 0, "retry does not synthesize again");
  assert(meter.requestCount() === 1, "a retry does not open another logical request");

  const sameText = "Hello from the studio.";
  const sameTextProvider = providerOf(audio, meter.trace, "ok");
  const sameTextClick = await play({ clock, meter, provider: sameTextProvider, text: sameText });
  assert(sameTextClick.ok, "a new click with the same text returns audio");
  if (!sameTextClick.ok) return;
  await readBody(sameTextClick.stream);
  assert(sameTextClick.usageKey !== first.usageKey, "a new click with the same text receives a new key");
  assert(sameTextProvider.calls === 1, "a new click with the same text synthesizes again");
  assert(meter.requestCount() === 2, "a new click with the same text opens another logical request");
  assert(meter.snapshot(sameTextClick.usageKey).state === "completed", "the new request can complete on its own");

  const fresh = providerOf(audio, meter.trace, "ok");
  const secondAction = await play({ clock, meter, provider: fresh, text: "A different sentence for the studio." });
  assert(secondAction.ok, "a new action returns audio");
  if (!secondAction.ok) return;
  await readBody(secondAction.stream);
  assert(secondAction.usageKey !== first.usageKey, "a new action receives a new key");
  assert(fresh.calls === 1, "a new action calls the provider");

  const mismatchProvider = providerOf(audio, meter.trace, "ok");
  const mismatch = await play({
    clock,
    meter,
    provider: mismatchProvider,
    usageKey: first.usageKey,
    text: "Not the original sentence.",
  });
  assert(!mismatch.ok && mismatch.code === "binding_mismatch", "a key bound to other speech is rejected");
  assert(mismatchProvider.calls === 0, "a mismatched key does not call the provider");

  let releaseHold: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const raceClock = { ms: clock.ms };
  const raceMeter = createMeterDouble(raceClock);
  const binding = hostTtsSynthesisBinding({ text: "Hello from the studio.", voice: "coral", language: "en", speed: 1 });
  const issued = await raceMeter.rpc.rpc(AI_USAGE_METER_RPC.issue, {
    p_billing_subject: hostTtsBillingSubject(USER_ID),
    p_source: "host_tts",
    p_operation: "tts",
    p_synthesis_binding_hash: binding.hash,
    p_host_id: USER_ID,
    p_property_id: null,
    p_reservation_id: null,
    p_expires_at: new Date(raceClock.ms + 60_000).toISOString(),
    p_key_origin: "issued",
  });
  const issuedRow = (Array.isArray(issued.data) ? issued.data[0] : null) as { result_client_usage_key?: string } | null;
  const raceKey = issuedRow?.result_client_usage_key ?? "";
  assert(raceKey.length > 0, "concurrency fixture issued a key");
  const raceProvider = providerOf(audio, raceMeter.trace, "hold", hold);
  const leader = play({ clock: raceClock, meter: raceMeter, provider: raceProvider, usageKey: raceKey });
  for (let i = 0; i < 50 && raceProvider.calls < 1; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(raceProvider.calls === 1, "the first concurrent playback reached the provider");
  const follower = await play({ clock: raceClock, meter: raceMeter, provider: raceProvider, usageKey: raceKey });
  assert(!follower.ok && follower.code === "busy", "the overlapping playback is busy");
  assert(raceProvider.calls === 1, "the busy playback does not call the provider");
  releaseHold();
  const leaderResult = await leader;
  assert(leaderResult.ok, "the first concurrent playback completes");
  if (leaderResult.ok) await readBody(leaderResult.stream);
  assert(raceMeter.snapshot(raceKey).state === "completed", "one concurrent winner is stored");
  assert(raceProvider.calls === 1, "concurrency uses one provider call");

  const fallbackClock = { ms: clock.ms };
  const fallbackMeter = createMeterDouble(fallbackClock);
  const fallbackProvider = providerOf(audio, fallbackMeter.trace, "fallback");
  const fallbackPlay = await play({ clock: fallbackClock, meter: fallbackMeter, provider: fallbackProvider });
  assert(fallbackPlay.ok, "fallback playback returns audio");
  if (!fallbackPlay.ok) return;
  const fallbackBytes = await readBody(fallbackPlay.stream);
  assert(sameBytes(fallbackBytes, audio), "fallback audio matches the second provider response");
  assert(fallbackProvider.calls === 2, "fallback is a second provider call");
  assert(fallbackMeter.trace.includes("provider:primary") && fallbackMeter.trace.includes("provider:fallback"), "primary and fallback are separate attempts");
  const fallbackSnap = fallbackMeter.snapshot(fallbackPlay.usageKey);
  assert(fallbackSnap.state === "completed" && fallbackSnap.eligibility === "withheld", "fallback completion stays withheld");
  assert(fallbackSnap.attempts.length === 2, "fallback keeps both attempts");

  const partialClock = { ms: clock.ms };
  const partialMeter = createMeterDouble(partialClock);
  const partialProvider = providerOf(audio, partialMeter.trace, "partial");
  const partialPlay = await play({ clock: partialClock, meter: partialMeter, provider: partialProvider });
  assert(partialPlay.ok, "partial audio still opens a stream");
  if (!partialPlay.ok) return;
  let partialFailed = false;
  try {
    await readBody(partialPlay.stream);
  } catch {
    partialFailed = true;
  }
  assert(partialFailed, "truncated pcm fails the stream");
  const partialSnap = partialMeter.snapshot(partialPlay.usageKey);
  assert(partialSnap.state !== "completed", "incomplete audio is not completed");
  assert(!partialSnap.attempts.includes("provider_complete"), "incomplete audio is not provider_complete");
  assert(partialProvider.calls === 1, "a truncated stream does not start fallback");

  const expiryClock = { ms: clock.ms };
  const expiryMeter = createMeterDouble(expiryClock);
  const expiryProvider = providerOf(audio, expiryMeter.trace, "ok");
  const expiring = await play({ clock: expiryClock, meter: expiryMeter, provider: expiryProvider, requestTtlMs: 1000 });
  assert(expiring.ok, "playback before expiry returns audio");
  if (!expiring.ok) return;
  await readBody(expiring.stream);
  expiryClock.ms += 5_000;
  const expired = await play({
    clock: expiryClock,
    meter: expiryMeter,
    provider: expiryProvider,
    usageKey: expiring.usageKey,
    requestTtlMs: 1000,
  });
  assert(!expired.ok && expired.code === "expired", "an expired key is refused");
  assert(expiryProvider.calls === 1, "an expired key does not synthesize again");

  const events = aggregateAiUsageRows([
    {
      provider: "openai",
      model: "gpt-4o-mini-tts",
      status: "success",
      input_characters: 20,
      calculated_cost_cents: 4,
      pricing_rule_id: null,
      cost_class: "exact",
      operation: "tts",
      host_id: null,
      reservation_id: null,
      property_id: null,
    },
  ]);
  const merged = mergeHostTtsMeterMonth(events, {
    logicalRequests: 1,
    completedRequests: 1,
    failedRequests: 0,
    observedAttempts: 1,
    characters: 12,
    pendingCostAttempts: 1,
    pendingCharacters: 12,
    estimatedCostCents: null,
    totalsPartial: true,
  });
  assert(merged.ttsRequests === 2, "metered host playback is added once to event totals");
  assert(merged.exactTrackedCostCents === 4, "pending meter audio does not change the known tariff");
  assert(merged.exactTrackedCostLabel !== "$0.00", "pending meter audio is not shown as zero");
  assert(merged.totalsArePartial === true, "pending meter audio keeps the month partial");
  const meterOnly = mergeHostTtsMeterMonth(aggregateAiUsageRows([]), {
    logicalRequests: 1,
    completedRequests: 1,
    failedRequests: 0,
    observedAttempts: 1,
    characters: 12,
    pendingCostAttempts: 1,
    pendingCharacters: 12,
    estimatedCostCents: null,
    totalsPartial: true,
  });
  assert(meterOnly.exactTrackedCostCents === null, "a meter-only pending month has no dollar total");
  assert(meterOnly.exactTrackedCostLabel === "—", "a meter-only pending month is unlabeled");
  assert(hostTtsMeterEnabled({}) === false, "the write flag stays off while historical totals are kept");
  const recordedMeter = {
    logicalRequests: 3,
    completedRequests: 2,
    failedRequests: 1,
    observedAttempts: 3,
    characters: 40,
    pendingCostAttempts: 2,
    pendingCharacters: 18,
    estimatedCostCents: 25,
    totalsPartial: true,
  };
  const historySnapshot = {
    ...events,
    serviceRoleReady: true,
    error: null,
    timeZone: "America/New_York",
    monthLabel: "September 2026",
    rangeStartUtc: "2026-09-01T04:00:00.000Z",
    rangeEndUtc: "2026-10-01T04:00:00.000Z",
    readIncomplete: false,
    readIncompleteNote: null,
    readUnavailable: false,
    readUnavailableNote: null,
    openaiSpendReconciliation: "",
    costNote: "",
  } as AiUsageMonthSnapshot;
  const kept = applyHostTtsMeterHistory(historySnapshot, events, { ok: true, summary: recordedMeter });
  assert(kept.ttsRequests === events.ttsRequests + 3, "flag-off history keeps recorded meter requests");
  assert(kept.ttsSuccessful === events.ttsSuccessful + 2, "flag-off history keeps completed meter requests");
  assert(kept.ttsFailed === events.ttsFailed + 1, "flag-off history keeps failed meter requests");
  assert(kept.pendingExactPricingEvents === events.pendingExactPricingEvents + 2, "flag-off history keeps meter attempts with pending cost");
  assert(kept.exactTrackedCostCents === 4 + 25, "flag-off history keeps recorded meter cost");
  assert(kept.exactTrackedCostLabel !== "$0.00", "recorded meter cost is not shown as zero");
  const failedHistory = applyHostTtsMeterHistory(historySnapshot, events, {
    ok: false,
    error: "Could not read the host TTS meter.",
  });
  assert(failedHistory.readIncomplete === true, "a meter read failure stays explicit");
  assert(failedHistory.ttsRequests === events.ttsRequests, "a meter read failure keeps the event request count");
  assert(failedHistory.exactTrackedCostCents === events.exactTrackedCostCents, "a meter read failure does not zero known cost");
  assert(failedHistory.error === "Could not read the host TTS meter.", "the meter error text is preserved");
  const parsed = await readHostTtsMeterMonth(
    {
      rpc: async () => ({
        data: [{
          logical_requests: 1,
          completed_requests: 0,
          failed_requests: 0,
          observed_attempts: 1,
          characters: 7,
          pending_cost_attempts: 1,
          pending_characters: 7,
          estimated_cost_cents: null,
          totals_partial: true,
        }],
        error: null,
      }),
    },
    new Date("2026-04-01T00:00:00.000Z"),
    new Date("2026-05-01T00:00:00.000Z"),
  );
  assert(parsed.ok === true && parsed.summary.observedAttempts === 1, "the reader keeps observed attempts");
  assert(parsed.ok === true && parsed.summary.totalsPartial === true, "the reader keeps a partial total");
  const missingObserved = await readHostTtsMeterMonth(
    {
      rpc: async () => ({
        data: [{
          logical_requests: 0,
          completed_requests: 0,
          failed_requests: 0,
          characters: 0,
          pending_cost_attempts: 0,
          pending_characters: 0,
          estimated_cost_cents: null,
          totals_partial: false,
        }],
        error: null,
      }),
    },
    new Date("2026-04-01T00:00:00.000Z"),
    new Date("2026-05-01T00:00:00.000Z"),
  );
  assert(missingObserved.ok === false, "a meter row without observed attempts is not a complete read");
  const unread = await readHostTtsMeterMonth(
    { rpc: async () => ({ data: null, error: { message: "missing function" } }) },
    new Date("2026-09-01T00:00:00.000Z"),
    new Date("2026-10-01T00:00:00.000Z"),
  );
  assert(unread.ok === false, "a failed meter read is not treated as zero");

  resetHostTtsUsageKeyForTests();
  const action = beginHostTtsPlaybackAction();
  const sameTextAction = beginHostTtsPlaybackAction();
  rememberHostTtsUsageKey(action, first.usageKey);
  assert(hostTtsUsageKeyForAction(action) === first.usageKey, "a retry of the same action reuses its key");
  assert(action !== sameTextAction, "a new click is a different action");
  assert(hostTtsUsageKeyForAction(sameTextAction) === null, "a new click does not reuse the previous key");
  forgetHostTtsUsageKey(action);
  assert(hostTtsUsageKeyForAction(action) === null, "an expired action drops its key");
}

const isDirectRun = process.argv[1]?.includes("host-tts-meter.test");
if (isDirectRun) {
  runHostTtsMeterTests()
    .then(() => {
      console.log("host tts meter tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "host tts meter tests failed");
      process.exitCode = 1;
    });
}
