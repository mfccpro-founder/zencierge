/**
 * Pure B4C single-enroll gate (dev/sandbox only). No I/O.
 * Production and non-matching intents stay blocked.
 * Authorized intent id comes only from server-provided config — never a fallback UUID.
 */

if (typeof window !== "undefined") {
  throw new Error("b4c-single-enroll-gate is server-only");
}

export const SQUARE_B4C_AUTHORIZED_INTENT_ENV =
  "SQUARE_B4C_AUTHORIZED_INTENT_ID";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL_OR_DEAD_STATUSES = new Set([
  "expired",
  "completed",
  "failed",
  "canceled",
  "cancelled",
]);

const LIVE_STATUSES = new Set([
  "pending",
  "customer_ready",
  "card_ready",
  "subscription_ready",
]);

export type B4cSingleEnrollGateInput = {
  nodeEnv: string | undefined;
  squareEnvironment: string | undefined;
  intentId: string;
  authorizedIntentId: string | null | undefined;
  sessionUserId: string | null | undefined;
  intentOwnerUserId: string | null | undefined;
  intentStatus: string | null | undefined;
  expiresAt: string | null | undefined;
  nowMs?: number;
};

export type B4cSingleEnrollGateResult = {
  allowed: boolean;
  reason: string;
};

export function resolveSquareB4cAuthorizedIntentId(
  envValue: string | null | undefined,
): string | null {
  const trimmed = (envValue ?? "").trim();
  if (!trimmed) return null;
  if (!UUID_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function readSquareB4cAuthorizedIntentIdFromEnv(
  env: NodeJS.Dict<string> = process.env,
): string | null {
  return resolveSquareB4cAuthorizedIntentId(
    env[SQUARE_B4C_AUTHORIZED_INTENT_ENV],
  );
}

export function resolveB4cSingleEnrollAllowed(
  input: B4cSingleEnrollGateInput,
): B4cSingleEnrollGateResult {
  if ((input.nodeEnv || "").trim() === "production") {
    return { allowed: false, reason: "production" };
  }

  if ((input.squareEnvironment || "").trim().toLowerCase() !== "sandbox") {
    return { allowed: false, reason: "square_env_not_sandbox" };
  }

  const authorizedIntentId = resolveSquareB4cAuthorizedIntentId(
    input.authorizedIntentId,
  );
  if (!authorizedIntentId) {
    return { allowed: false, reason: "authorized_intent_unconfigured" };
  }

  const intentId = (input.intentId || "").trim().toLowerCase();
  if (intentId !== authorizedIntentId) {
    return { allowed: false, reason: "intent_not_authorized" };
  }

  const sessionUserId = (input.sessionUserId || "").trim();
  if (!sessionUserId) {
    return { allowed: false, reason: "no_session" };
  }

  const intentOwnerUserId = (input.intentOwnerUserId || "").trim();
  if (!intentOwnerUserId) {
    return { allowed: false, reason: "intent_owner_lookup_failed" };
  }

  if (intentOwnerUserId !== sessionUserId) {
    return { allowed: false, reason: "session_owner_mismatch" };
  }

  const status = (input.intentStatus || "").trim().toLowerCase();
  if (!status) {
    return { allowed: false, reason: "intent_status_missing" };
  }
  if (TERMINAL_OR_DEAD_STATUSES.has(status)) {
    return { allowed: false, reason: "intent_terminal_or_expired" };
  }
  if (!LIVE_STATUSES.has(status)) {
    return { allowed: false, reason: "intent_status_not_live" };
  }

  const expiresAt = (input.expiresAt || "").trim();
  if (!expiresAt) {
    return { allowed: false, reason: "intent_expires_missing" };
  }
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return { allowed: false, reason: "intent_expires_invalid" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (expiresMs <= nowMs) {
    return { allowed: false, reason: "intent_expired" };
  }

  return { allowed: true, reason: "ok" };
}
