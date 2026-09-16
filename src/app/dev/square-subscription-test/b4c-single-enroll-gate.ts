/**
 * Pure B4C single-enroll gate (dev/sandbox only). No I/O.
 * Production and non-matching intents stay blocked.
 */

export const B4C_AUTHORIZED_ENROLL_INTENT_ID =
  "8ae24a84-e04c-4c5d-be30-254a002095d6";

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

export function resolveB4cSingleEnrollAllowed(
  input: B4cSingleEnrollGateInput,
): B4cSingleEnrollGateResult {
  if ((input.nodeEnv || "").trim() === "production") {
    return { allowed: false, reason: "production" };
  }

  if ((input.squareEnvironment || "").trim().toLowerCase() !== "sandbox") {
    return { allowed: false, reason: "square_env_not_sandbox" };
  }

  if (input.intentId !== B4C_AUTHORIZED_ENROLL_INTENT_ID) {
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
