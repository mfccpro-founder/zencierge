/** Server-only host TTS meter. Guest routes do not import this. The flag defaults off. */
if (typeof window !== "undefined") {
  throw new Error("host-tts-meter is server-only");
}

import { createHash, randomUUID } from "node:crypto";
import {
  AI_USAGE_METER_RPC,
  callAiUsageMeter,
  type AiUsageMeterRpcClient,
} from "@/lib/ai-usage-meter";
import {
  aiUsageTtsAudioRetentionHours,
  readAiUsageReplayAudio,
  storeAiUsageAttemptAudio,
  type AiUsageAudioStorage,
} from "@/lib/ai-usage-audio";
import {
  OPENAI_STREAM_TTS_MODEL,
  OPENAI_TTS_PCM_RATE,
  normalizeHostTtsSpeech,
  type TtsLanguage,
} from "@/lib/tts-synthesize";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HostTtsProviderAttempt = "primary" | "fallback";

export type HostTtsProviderResult =
  | {
      ok: true;
      stream: ReadableStream<Uint8Array>;
      contentType: "audio/pcm";
      model: string;
      voice: string;
      language: TtsLanguage;
      sampleRate: number;
    }
  | { ok: false; message: string };

export type HostTtsProvider = {
  synthesize(input: {
    text: string;
    voice: string;
    language: TtsLanguage;
    speed: number;
    attempt: HostTtsProviderAttempt;
  }): Promise<HostTtsProviderResult>;
};

export type HostTtsMeterSuccess = {
  ok: true;
  usageKey: string;
  stream: ReadableStream<Uint8Array>;
  contentType: "audio/pcm";
  voice: string;
  language: TtsLanguage;
  sampleRate: number;
  model: string;
};

export type HostTtsMeterFailure = {
  ok: false;
  status: number;
  usageKey: string | null;
  error: string;
  code: string;
};

export type ServeHostTtsMeterInput = {
  rpc: AiUsageMeterRpcClient;
  storage: AiUsageAudioStorage;
  provider: HostTtsProvider;
  userId: string;
  usageKey?: string | null;
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
  now?: () => Date;
  requestTtlMs?: number;
  leaseSeconds?: number;
};

export function hostTtsBillingSubject(userId: string): string {
  return `host:${userId.trim()}`;
}

export function hostTtsSynthesisBinding(input: {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
}) {
  const speech = normalizeHostTtsSpeech({
    text: input.text,
    voice: input.voice,
    language: input.language === "es" || input.language === "en" ? input.language : "auto",
    speed: input.speed,
  });
  const canonical = [
    "host_tts",
    "tts",
    OPENAI_STREAM_TTS_MODEL,
    "pcm",
    String(OPENAI_TTS_PCM_RATE),
    speech.language,
    speech.voice,
    speech.speed.toFixed(4),
    speech.text,
  ].join("\n");
  return {
    ...speech,
    hash: createHash("sha256").update(canonical).digest("hex"),
  };
}

function enabled(value: unknown) {
  return value === true || value === "t" || value === "true";
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function failure(status: number, error: string, code: string, usageKey: string | null = null): HostTtsMeterFailure {
  return { ok: false, status, usageKey, error, code };
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function serveHostTtsMeter(input: ServeHostTtsMeterInput): Promise<HostTtsMeterSuccess | HostTtsMeterFailure> {
  const userId = input.userId.trim();
  if (!UUID_RE.test(userId)) {
    return failure(401, "Unauthorized", "unauthorized");
  }
  const now = input.now ?? (() => new Date());
  const binding = hostTtsSynthesisBinding(input);
  const subject = hostTtsBillingSubject(userId);
  const ttl = input.requestTtlMs ?? aiUsageTtsAudioRetentionHours() * 60 * 60 * 1000;
  if (!Number.isFinite(ttl) || ttl < 1000) {
    return failure(500, "Host TTS meter expiry is not configured.", "meter_unavailable");
  }
  const requestExpiresAt = new Date(now().getTime() + ttl).toISOString();

  let usageKey = input.usageKey?.trim() ?? "";
  if (!usageKey) {
    const issued = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.issue, {
      p_billing_subject: subject,
      p_source: "host_tts",
      p_operation: "tts",
      p_synthesis_binding_hash: binding.hash,
      p_host_id: userId,
      p_property_id: null,
      p_reservation_id: null,
      p_expires_at: requestExpiresAt,
      p_key_origin: "issued",
    });
    usageKey = textValue(issued.row?.result_client_usage_key);
    if (issued.error || !usageKey) {
      return failure(503, "Host TTS meter could not issue a usage key.", "meter_unavailable");
    }
  }

  const validated = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.validate, {
    p_client_usage_key: usageKey,
    p_billing_subject: subject,
    p_source: "host_tts",
    p_operation: "tts",
    p_synthesis_binding_hash: binding.hash,
  });
  if (validated.error || !enabled(validated.row?.result_ok)) {
    const reason = textValue(validated.row?.result_rejection_reason);
    if (reason === "expired") {
      return failure(410, "This playback key has expired.", "expired", usageKey);
    }
    if (reason === "binding_mismatch" || reason === "subject_mismatch") {
      return failure(409, "This playback key does not match the requested speech.", "binding_mismatch");
    }
    return failure(409, "This playback key cannot be used.", reason || "rejected");
  }

  const replay = await readAiUsageReplayAudio(
    { rpc: input.rpc, storage: input.storage, now },
    { clientUsageKey: usageKey, billingSubject: subject },
  );
  if (replay.ok) {
    return {
      ok: true,
      usageKey,
      stream: byteStream(replay.bytes),
      contentType: "audio/pcm",
      voice: binding.voice,
      language: binding.language,
      sampleRate: OPENAI_TTS_PCM_RATE,
      model: OPENAI_STREAM_TTS_MODEL,
    };
  }

  const acquired = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.acquire, {
    p_client_usage_key: usageKey,
    p_billing_subject: subject,
    p_source: "host_tts",
    p_operation: "tts",
    p_synthesis_binding_hash: binding.hash,
    p_lease_seconds: input.leaseSeconds ?? 120,
    p_allow_retry: true,
  });
  if (acquired.error || !acquired.row) {
    return failure(503, "Host TTS meter could not acquire this playback.", "meter_unavailable", usageKey);
  }
  const outcome = textValue(acquired.row.result_outcome);
  if (outcome === "completed") {
    const again = await readAiUsageReplayAudio(
      { rpc: input.rpc, storage: input.storage, now },
      { clientUsageKey: usageKey, billingSubject: subject },
    );
    if (!again.ok) {
      return failure(410, "Completed audio for this playback is no longer available.", "expired", usageKey);
    }
    return {
      ok: true,
      usageKey,
      stream: byteStream(again.bytes),
      contentType: "audio/pcm",
      voice: binding.voice,
      language: binding.language,
      sampleRate: OPENAI_TTS_PCM_RATE,
      model: OPENAI_STREAM_TTS_MODEL,
    };
  }
  if (outcome === "busy") {
    return failure(409, "This playback is already in progress.", "busy", usageKey);
  }
  if (outcome !== "acquired") {
    const reason = textValue(acquired.row.result_rejection_reason);
    if (reason === "expired") return failure(410, "This playback key has expired.", "expired", usageKey);
    return failure(409, "This playback key cannot be used.", reason || outcome || "rejected", usageKey);
  }

  const requestId = textValue(acquired.row.result_logical_request_id);
  let attemptId = textValue(acquired.row.result_attempt_id);
  const token = textValue(acquired.row.result_acquisition_token);
  if (!requestId || !attemptId || !token) {
    return failure(503, "Host TTS meter returned an incomplete acquisition.", "meter_unavailable", usageKey);
  }

  const renewed = await renewLease(input, requestId, token);
  if (!renewed) {
    await closeRequest(input, requestId, token, "uncertain");
    return failure(409, "This playback lease could not be renewed.", "lease_expired", usageKey);
  }

  const played = await synthesizeAttempt(input, {
    requestId,
    attemptId,
    token,
    binding,
    usageKey,
    characters: binding.text.length,
    requestExpiresAt,
    attempt: "primary",
  });
  if (played.ok || played.code !== "provider_failed") return played;

  const fallback = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.fallback, {
    p_logical_request_id: requestId,
    p_acquisition_token: token,
  });
  attemptId = textValue(fallback.row?.result_attempt_id);
  if (fallback.error || !enabled(fallback.row?.result_started) || !attemptId) {
    await closeRequest(input, requestId, token, "failed");
    return failure(502, played.error, "ADVANCED_AUDIO_FAILED", usageKey);
  }
  const fallbackRenewed = await renewLease(input, requestId, token);
  if (!fallbackRenewed) {
    await closeRequest(input, requestId, token, "uncertain");
    return failure(409, "This playback lease could not be renewed.", "lease_expired", usageKey);
  }
  const second = await synthesizeAttempt(input, {
    requestId,
    attemptId,
    token,
    binding,
    usageKey,
    characters: binding.text.length,
    requestExpiresAt,
    attempt: "fallback",
  });
  if (!second.ok) await closeRequest(input, requestId, token, "failed");
  return second;
}

async function renewLease(input: ServeHostTtsMeterInput, requestId: string, token: string) {
  const renewed = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.renew, {
    p_logical_request_id: requestId,
    p_acquisition_token: token,
    p_lease_seconds: input.leaseSeconds ?? 120,
  });
  return !renewed.error && enabled(renewed.row?.result_renewed);
}

async function closeRequest(
  input: ServeHostTtsMeterInput,
  requestId: string,
  token: string,
  outcome: "failed" | "uncertain",
) {
  await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.close, {
    p_logical_request_id: requestId,
    p_acquisition_token: token,
    p_outcome: outcome,
  });
}

async function synthesizeAttempt(
  input: ServeHostTtsMeterInput,
  attempt: {
    requestId: string;
    attemptId: string;
    token: string;
    binding: ReturnType<typeof hostTtsSynthesisBinding>;
    usageKey: string;
    characters: number;
    requestExpiresAt: string;
    attempt: HostTtsProviderAttempt;
  },
): Promise<HostTtsMeterSuccess | HostTtsMeterFailure> {
  const started = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.dispatchStarted, {
    p_attempt_id: attempt.attemptId,
    p_acquisition_token: attempt.token,
  });
  if (started.error || !enabled(started.row?.result_updated)) {
    await closeRequest(input, attempt.requestId, attempt.token, "uncertain");
    return failure(409, "This playback could not be dispatched.", "lease_expired", attempt.usageKey);
  }

  let providerResult: HostTtsProviderResult;
  try {
    providerResult = await input.provider.synthesize({
      text: attempt.binding.text,
      voice: attempt.binding.voice,
      language: attempt.binding.language,
      speed: attempt.binding.speed,
      attempt: attempt.attempt,
    });
  } catch (error: unknown) {
    providerResult = { ok: false, message: error instanceof Error ? error.message : "Could not generate speech audio" };
  }
  if (!providerResult.ok) {
    await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.recordResult, {
      p_attempt_id: attempt.attemptId,
      p_acquisition_token: attempt.token,
      p_result_state: "failed",
      p_calculated_cost_cents: null,
      p_cost_class: "pending",
      p_provider: "openai",
      p_model: OPENAI_STREAM_TTS_MODEL,
      p_input_characters: attempt.characters,
      p_audio_bytes: null,
      p_stream_completed: false,
    });
    return failure(502, providerResult.message, "provider_failed", attempt.usageKey);
  }

  const observed = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.responseObserved, {
    p_attempt_id: attempt.attemptId,
    p_acquisition_token: attempt.token,
  });
  if (observed.error || !enabled(observed.row?.result_updated)) {
    await closeRequest(input, attempt.requestId, attempt.token, "uncertain");
    return failure(409, "This playback lease ended before audio arrived.", "lease_expired", attempt.usageKey);
  }

  const model = providerResult.model;
  const voice = providerResult.voice;
  const language = providerResult.language;
  const sampleRate = providerResult.sampleRate;
  const reader = providerResult.stream.getReader();
  let settled = false;
  let reading = false;

  const finish = async (bytes: Uint8Array, failed: boolean) => {
    if (settled) return;
    settled = true;
    const complete = !failed && bytes.byteLength >= 2 && bytes.byteLength % 2 === 0;
    if (!complete) {
      await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.recordResult, {
        p_attempt_id: attempt.attemptId,
        p_acquisition_token: attempt.token,
        p_result_state: "failed",
        p_calculated_cost_cents: null,
        p_cost_class: "pending",
        p_provider: "openai",
        p_model: model,
        p_input_characters: attempt.characters,
        p_audio_bytes: bytes.byteLength,
        p_stream_completed: false,
      });
      await closeRequest(input, attempt.requestId, attempt.token, "failed");
      return;
    }
    const stillLeased = await renewLease(input, attempt.requestId, attempt.token);
    if (!stillLeased) {
      await closeRequest(input, attempt.requestId, attempt.token, "uncertain");
      return;
    }
    const recorded = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.recordResult, {
      p_attempt_id: attempt.attemptId,
      p_acquisition_token: attempt.token,
      p_result_state: "provider_complete",
      p_calculated_cost_cents: null,
      p_cost_class: "pending",
      p_provider: "openai",
      p_model: model,
      p_input_characters: attempt.characters,
      p_audio_bytes: bytes.byteLength,
      p_stream_completed: true,
    });
    if (recorded.error || !enabled(recorded.row?.result_recorded)) {
      await closeRequest(input, attempt.requestId, attempt.token, "uncertain");
      return;
    }
    const stored = await storeAiUsageAttemptAudio(
      { rpc: input.rpc, storage: input.storage, now: input.now, newObjectKey: () => `audio/${randomUUID()}` },
      {
        attemptId: attempt.attemptId,
        acquisitionToken: attempt.token,
        bytes,
        contentType: "audio/pcm",
        requestExpiresAt: attempt.requestExpiresAt,
      },
    );
    if (!stored.ok) {
      await closeRequest(input, attempt.requestId, attempt.token, "failed");
      return;
    }
    const closed = await callAiUsageMeter(input.rpc, AI_USAGE_METER_RPC.close, {
      p_logical_request_id: attempt.requestId,
      p_acquisition_token: attempt.token,
      p_outcome: "completed",
    });
    if (textValue(closed.row?.result_outcome) !== "completed" || textValue(closed.row?.result_billing_eligibility) !== "withheld") {
      await closeRequest(input, attempt.requestId, attempt.token, "uncertain");
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (reading) return;
      reading = true;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (next.value?.byteLength) {
            chunks.push(next.value);
            controller.enqueue(next.value);
          }
        }
        const bytes = concatBytes(chunks);
        await finish(bytes, false);
        if (bytes.byteLength >= 2 && bytes.byteLength % 2 === 0) controller.close();
        else controller.error(new Error("Streaming TTS returned incomplete PCM."));
      } catch (error: unknown) {
        await finish(concatBytes(chunks), true);
        controller.error(error instanceof Error ? error : new Error("Streaming TTS failed."));
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    },
    cancel() {
      return finish(new Uint8Array(0), true);
    },
  });

  return {
    ok: true,
    usageKey: attempt.usageKey,
    stream,
    contentType: "audio/pcm",
    voice,
    language,
    sampleRate,
    model,
  };
}
