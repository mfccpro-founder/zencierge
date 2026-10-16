/** Server-only callers for the TTS meter functions. Host /api/tts uses them only when AI_USAGE_HOST_TTS_METER=1. Guest routes do not. */
if (typeof window !== "undefined") {
  throw new Error("ai-usage-meter is server-only");
}

export const AI_USAGE_AUDIO_BUCKET = "ai-usage-tts-audio";

/**
 * Postgres and Supabase Storage do not share a transaction.
 * Upload one private object per attempt only while the lease token is current.
 * The object key is a random id. It does not contain spoken text or personal data.
 * commit_ai_usage_attempt_audio binds the attempt and the acquisition token.
 * A stale acquisition token cannot replace a committed audio object.
 * This does not assume storage lifecycle expiry.
 * Orphan and expired objects are listed for cleanup. A worker deletes the
 * object, then acknowledge_ai_usage_audio_cleanup records the delete.
 */
export const AI_USAGE_AUDIO_STORAGE_PROTOCOL = [
  "Postgres and Supabase Storage do not share a transaction.",
  "One private object is stored per attempt.",
  "The object key is a random id without spoken text or personal data.",
  "commit_ai_usage_attempt_audio is conditioned on the acquisition token.",
  "A stale acquisition token cannot replace a committed audio object.",
  "This does not assume storage lifecycle expiry.",
  "Orphan and expired objects are listed for cleanup.",
].join(" ");

export const AI_USAGE_METER_RPC = {
  issue: "issue_ai_usage_logical_request",
  validate: "validate_ai_usage_logical_request",
  acquire: "acquire_ai_usage_logical_request",
  renew: "renew_ai_usage_lease",
  dispatchStarted: "mark_ai_usage_dispatch_started",
  responseObserved: "mark_ai_usage_response_observed",
  recordResult: "record_ai_usage_attempt_result",
  audioDeliveryFailure: "record_ai_usage_audio_delivery_failure",
  fallback: "begin_ai_usage_fallback_attempt",
  commitAudio: "commit_ai_usage_attempt_audio",
  close: "close_ai_usage_logical_request",
  expireLeases: "expire_ai_usage_leases",
  summarize: "summarize_ai_usage_tts_meter",
  markAudioCleanup: "mark_ai_usage_audio_for_cleanup",
  listAudioCleanup: "list_ai_usage_audio_cleanup",
  acknowledgeAudioCleanup: "acknowledge_ai_usage_audio_cleanup",
  describeAudio: "describe_ai_usage_audio_object",
  replay: "lookup_ai_usage_replay_audio",
} as const;

export type AiUsageMeterRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, string | number | boolean | null>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type AiUsageMeterCall = {
  row: Record<string, unknown> | null;
  error: string | null;
};

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  }
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

export async function callAiUsageMeter(
  admin: AiUsageMeterRpcClient,
  fn: string,
  args: Record<string, string | number | boolean | null>,
): Promise<AiUsageMeterCall> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) return { row: null, error: error.message };
  return { row: firstRow(data), error: null };
}

export function issueAiUsageLogicalRequest(
  admin: AiUsageMeterRpcClient,
  input: {
    billingSubject: string;
    source: "guest_stay_tts" | "guest_stay_welcome_tts" | "host_tts";
    synthesisBindingHash: string;
    hostId: string | null;
    propertyId: string | null;
    reservationId: string | null;
    expiresAt: string;
    keyOrigin?: "issued" | "legacy";
  },
) {
  return callAiUsageMeter(admin, AI_USAGE_METER_RPC.issue, {
    p_billing_subject: input.billingSubject,
    p_source: input.source,
    p_operation: "tts",
    p_synthesis_binding_hash: input.synthesisBindingHash,
    p_host_id: input.hostId,
    p_property_id: input.propertyId,
    p_reservation_id: input.reservationId,
    p_expires_at: input.expiresAt,
    p_key_origin: input.keyOrigin ?? "issued",
  });
}

export function acquireAiUsageLogicalRequest(
  admin: AiUsageMeterRpcClient,
  input: {
    clientUsageKey: string;
    billingSubject: string;
    source: "guest_stay_tts" | "guest_stay_welcome_tts" | "host_tts";
    synthesisBindingHash: string;
    leaseSeconds?: number;
    allowRetry?: boolean;
  },
) {
  return callAiUsageMeter(admin, AI_USAGE_METER_RPC.acquire, {
    p_client_usage_key: input.clientUsageKey,
    p_billing_subject: input.billingSubject,
    p_source: input.source,
    p_operation: "tts",
    p_synthesis_binding_hash: input.synthesisBindingHash,
    p_lease_seconds: input.leaseSeconds ?? 30,
    p_allow_retry: input.allowRetry ?? false,
  });
}
