"use client";

import { useEffect, useRef, useState } from "react";
import { PAID_BILLING_CONSENT_VERSION } from "@/lib/paid-billing-consent";
import {
  ZENCIERGE_PLANS,
  type BillingCycle,
  type ZenciergePlanId,
} from "@/lib/zencierge-plans";

type WebPaymentsConfig = {
  applicationId: string;
  locationId: string;
  environment: "sandbox" | "production";
  sandbox: boolean;
};

type SquareTokenizeError = {
  code?: string;
  message?: string;
  field?: string;
};

type SquareTokenizeResult = {
  status: string;
  token?: string;
  errors?: SquareTokenizeError[];
};

type SquareCard = {
  attach: (selector: string) => Promise<void>;
  destroy?: () => Promise<void> | void;
  tokenize: () => Promise<SquareTokenizeResult>;
};

type SquarePayments = {
  card: () => Promise<SquareCard>;
  verifyBuyer?: (
    sourceId: string,
    details: {
      amount: string;
      currencyCode: string;
      intent: string;
      billingContact?: { givenName?: string; familyName?: string };
    },
  ) => Promise<{ token?: string }>;
};

type SquareGlobal = {
  payments: (applicationId: string, locationId: string) => SquarePayments;
};

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

export type SquareSubscriptionCardFormProps = {
  intentId: string;
  planId: ZenciergePlanId;
  billingCycle: BillingCycle;
  amountUsd: number;
  /** When true, tokenize UI still mounts but enroll POST is blocked (B4B). */
  disableEnroll?: boolean;
  /**
   * When true, show safe tokenize diagnostics after a subscribe click.
   * B4C sandbox page should enable this; never renders token/sourceId values.
   */
  showTokenizationDiagnostics?: boolean;
  /**
   * Sandbox B4C only: run tokenize() and show safe diagnostics, but NEVER
   * POST /api/payments/square/subscribe — even when tokenize succeeds.
   */
  diagnosticOnly?: boolean;
  /**
   * When true, lock the Subscribe button after the first click (no double POST).
   */
  oneShotSubmit?: boolean;
  /**
   * Changing this value clears a prior one-shot lock (B4C controlled retry only).
   */
  oneShotUnlockKey?: string;
  /**
   * B4C sandbox/dev only: show the safe subscribe route `error` code under the
   * friendly message. Default false — production UI must not expose this.
   */
  showSafeSubscribeDiagnostics?: boolean;
  /**
   * B4C sandbox/dev only: enable lastSubmitStage tracing (never logs tokens).
   * Default false — production callers must leave this off.
   */
  showB4cSubmitTrace?: boolean;
  /** Dev-only: notified when a safe submit stage is recorded. */
  onSubmitTraceChange?: (trace: B4cSubmitTraceSnapshot) => void;
  onReady?: () => void;
  onInitError?: (message: string) => void;
  onSuccess?: (result: {
    intentId: string;
    subscriptionId: string;
    status: string;
  }) => void;
};

/** Safe, allowlisted stage names for B4C submit forensics (no secrets). */
export type B4cSubmitTraceStage =
  | "click_received"
  | "blocked_disableEnroll"
  | "blocked_no_card_ref"
  | "blocked_submitting"
  | "blocked_submitLocked"
  | "tokenize_started"
  | "tokenize_failed"
  | "tokenize_success"
  | "blocked_diagnosticOnly"
  | "blocked_shouldCallSubscribe_false"
  | "ready_for_fetch"
  | "fetch_started"
  | "fetch_response_received";

export type B4cSubmitTraceSnapshot = {
  stage: B4cSubmitTraceStage;
  cardReady: boolean;
  submitting: boolean;
  submitLocked: boolean;
  diagnosticOnly: boolean;
};

export const B4C_SUBMIT_TRACE_BUILD = "v1";


export type SafeTokenizationError = {
  code: string | null;
  message: string | null;
  field: string | null;
};

export type SafeTokenizationDiagnostic = {
  /** Raw status string from Square, truncated/sanitized (never a token). */
  resultStatus: string | null;
  statusLabel: "SUCCESS" | "FAILURE" | "UNKNOWN";
  tokenCreated: "YES" | "NO";
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  safeErrors: SafeTokenizationError[];
};

const SAFE_SUBSCRIBE_ERROR_CODES = new Set([
  "unauthorized",
  "not_found",
  "forbidden",
  "expired",
  "invalid_lifecycle",
  "invalid_input",
  "conflict",
  "customer_failed",
  "card_failed",
  "subscription_failed",
  "persist_failed",
  "unavailable",
]);

/** Friendly copy for subscribe failures — unchanged for all callers. */
export function formatSubscribeUserMessage(errorCode: string | null | undefined): string {
  if (errorCode === "card_failed") {
    return "Card could not be saved. Please try again.";
  }
  if (errorCode === "subscription_failed") {
    return "Subscription could not be started. Please try again.";
  }
  return "Unable to complete subscription enrollment.";
}

/**
 * Allowlisted safe subscribe error code for B4C diagnostics only.
 * Never returns tokens or free-form provider text.
 */
export function resolveSafeSubscribeDiagnosticCode(
  errorCode: unknown,
): string | null {
  if (typeof errorCode !== "string") return null;
  const trimmed = errorCode.trim();
  if (!SAFE_SUBSCRIBE_ERROR_CODES.has(trimmed)) return null;
  return trimmed;
}

const SENSITIVE_TEXT =
  /\b(?:cnon:[A-Za-z0-9_-]+|tok_[A-Za-z0-9_-]+|sq0[a-z]{2,}-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\d{12,19})\b/gi;

function sanitizeDiagnosticText(value: unknown, maxLen = 160): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(SENSITIVE_TEXT, "[redacted]").slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

function isTokenizeSuccessStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.trim().toUpperCase();
  return normalized === "OK" || normalized === "SUCCESS";
}

/**
 * Pure helper: summarize Square card.tokenize() into UI-safe fields.
 * Never copies token/sourceId values into the returned object.
 */
export function summarizeSquareTokenizationResult(
  result: {
    status?: string | null;
    token?: string | null;
    errors?: Array<{
      code?: string | null;
      message?: string | null;
      field?: string | null;
    } | null> | null;
  } | null | undefined,
): SafeTokenizationDiagnostic {
  if (!result || typeof result !== "object") {
    return {
      resultStatus: null,
      statusLabel: "UNKNOWN",
      tokenCreated: "NO",
      safeErrorCode: null,
      safeErrorMessage: null,
      safeErrors: [],
    };
  }

  const resultStatus = sanitizeDiagnosticText(result.status, 40);
  const tokenCreated =
    typeof result.token === "string" && result.token.trim().length > 0
      ? "YES"
      : "NO";
  const success = isTokenizeSuccessStatus(result.status) && tokenCreated === "YES";

  const safeErrors: SafeTokenizationError[] = Array.isArray(result.errors)
    ? result.errors
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map((entry) => ({
          code: sanitizeDiagnosticText(entry.code, 64),
          message: sanitizeDiagnosticText(entry.message, 160),
          field: sanitizeDiagnosticText(entry.field, 40),
        }))
    : [];

  const first = safeErrors[0] ?? null;

  return {
    resultStatus,
    statusLabel: success
      ? "SUCCESS"
      : resultStatus
        ? "FAILURE"
        : "UNKNOWN",
    tokenCreated,
    safeErrorCode: first?.code ?? null,
    safeErrorMessage: first?.message ?? null,
    safeErrors,
  };
}

/** True only when tokenize produced a usable token and success status. */
export function shouldContinueToSubscribeAfterTokenize(
  diagnostic: SafeTokenizationDiagnostic,
): boolean {
  return (
    diagnostic.statusLabel === "SUCCESS" && diagnostic.tokenCreated === "YES"
  );
}

/**
 * Whether the enroll POST may run. diagnosticOnly always blocks the endpoint.
 * Token values are never considered — only safe diagnostic flags.
 */
export function shouldCallSubscribeEndpoint(input: {
  diagnostic: SafeTokenizationDiagnostic;
  diagnosticOnly?: boolean;
}): boolean {
  if (input.diagnosticOnly) return false;
  return shouldContinueToSubscribeAfterTokenize(input.diagnostic);
}

function squareScriptUrl(sandbox: boolean) {
  return sandbox
    ? "https://sandbox.web.squarecdn.com/v1/square.js"
    : "https://web.squarecdn.com/v1/square.js";
}

async function loadSquareScript(sandbox: boolean) {
  if (window.Square) return;
  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-square-web-payments="1"]',
  );
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Square script failed")),
        { once: true },
      );
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = squareScriptUrl(sandbox);
    script.async = true;
    script.dataset.squareWebPayments = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Square script failed to load"));
    document.head.appendChild(script);
  });
}

export function SquareSubscriptionCardForm({
  intentId,
  planId,
  billingCycle,
  amountUsd,
  disableEnroll = false,
  showTokenizationDiagnostics = false,
  diagnosticOnly = false,
  oneShotSubmit = false,
  oneShotUnlockKey = "",
  showSafeSubscribeDiagnostics = false,
  showB4cSubmitTrace = false,
  onSubmitTraceChange,
  onReady,
  onInitError,
  onSuccess,
}: SquareSubscriptionCardFormProps) {
  const cardRef = useRef<SquareCard | null>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    subscriptionId: string;
    status: string;
  } | null>(null);
  const [postalCode, setPostalCode] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [acceptedPaidTerms, setAcceptedPaidTerms] = useState(false);
  const [tokenizationDiagnostic, setTokenizationDiagnostic] =
    useState<SafeTokenizationDiagnostic | null>(null);
  const [sandboxMode, setSandboxMode] = useState(false);
  const [enrollmentPostBlocked, setEnrollmentPostBlocked] = useState(false);
  const [submitLocked, setSubmitLocked] = useState(false);
  const [safeSubscribeErrorCode, setSafeSubscribeErrorCode] = useState<
    string | null
  >(null);
  const [lastSubmitStage, setLastSubmitStage] =
    useState<B4cSubmitTraceStage | null>(null);

  const plan = ZENCIERGE_PLANS[planId];
  const billingLabel = billingCycle === "annual" ? "Annual" : "Monthly";
  const showDiagnostics =
    showTokenizationDiagnostics || sandboxMode || diagnosticOnly;
  const enrollBlockedByDisable = disableEnroll && !diagnosticOnly;

  const onReadyRef = useRef(onReady);
  const onInitErrorRef = useRef(onInitError);
  const onSubmitTraceChangeRef = useRef(onSubmitTraceChange);

  useEffect(() => {
    onReadyRef.current = onReady;
    onInitErrorRef.current = onInitError;
    onSubmitTraceChangeRef.current = onSubmitTraceChange;
  }, [onReady, onInitError, onSubmitTraceChange]);

  function recordSubmitStage(
    stage: B4cSubmitTraceStage,
    flags?: Partial<
      Pick<
        B4cSubmitTraceSnapshot,
        "cardReady" | "submitting" | "submitLocked" | "diagnosticOnly"
      >
    >,
  ) {
    if (!showB4cSubmitTrace) return;
    setLastSubmitStage(stage);
    onSubmitTraceChangeRef.current?.({
      stage,
      cardReady: flags?.cardReady ?? (Boolean(cardRef.current) && ready),
      submitting: flags?.submitting ?? submitting,
      submitLocked: flags?.submitLocked ?? submitLocked,
      diagnosticOnly: flags?.diagnosticOnly ?? diagnosticOnly,
    });
  }

  useEffect(() => {
    // Controlled B4C unlock only — does not auto-submit.
    // Intentional: remount-free unlock when parent bumps oneShotUnlockKey.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- B4C one-shot unlock key
    setSubmitLocked(false);
  }, [oneShotUnlockKey]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/payments/square/web-payments-config");
        const payload = (await response.json()) as
          | ({ ok: true } & WebPaymentsConfig)
          | { ok: false; error?: string };
        if (cancelled) return;
        if (!payload.ok) {
          const message = "Secure payments are not configured yet.";
          setError(message);
          onInitErrorRef.current?.(message);
          return;
        }

        const next: WebPaymentsConfig = {
          applicationId: payload.applicationId,
          locationId: payload.locationId,
          environment: payload.environment,
          sandbox: payload.sandbox,
        };
        setSandboxMode(next.sandbox === true);

        await loadSquareScript(next.sandbox);
        if (cancelled) return;
        if (!window.Square) {
          const message = "Square Web Payments SDK unavailable";
          setError(message);
          onInitErrorRef.current?.(message);
          return;
        }

        const payments = window.Square.payments(
          next.applicationId,
          next.locationId,
        );
        paymentsRef.current = payments;
        const card = await payments.card();
        if (cancelled) {
          void card.destroy?.();
          return;
        }
        await card.attach("#zencierge-square-card");
        if (cancelled) {
          void card.destroy?.();
          return;
        }
        cardRef.current = card;
        setReady(true);
        onReadyRef.current?.();
      } catch (cause) {
        if (!cancelled) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Unable to initialize secure card form";
          setError(message);
          onInitErrorRef.current?.(message);
        }
      }
    })();

    return () => {
      cancelled = true;
      const card = cardRef.current;
      cardRef.current = null;
      void card?.destroy?.();
    };
  }, []);

  async function handleSubscribe() {
    recordSubmitStage("click_received");
    if (enrollBlockedByDisable) {
      recordSubmitStage("blocked_disableEnroll");
      setError("Enroll is disabled on this sandbox UI readiness page.");
      return;
    }
    if (!cardRef.current) {
      recordSubmitStage("blocked_no_card_ref");
      return;
    }
    if (submitting) {
      recordSubmitStage("blocked_submitting");
      return;
    }
    if (submitLocked) {
      recordSubmitStage("blocked_submitLocked");
      return;
    }
    if (!acceptedPaidTerms) {
      setError("Confirm the displayed recurring price before subscribing.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setTokenizationDiagnostic(null);
    setEnrollmentPostBlocked(false);
    setSafeSubscribeErrorCode(null);
    let reachedFetch = false;
    try {
      recordSubmitStage("tokenize_started", { submitting: true });
      const tokenResult = await cardRef.current.tokenize();
      const diagnostic = summarizeSquareTokenizationResult(tokenResult);
      setTokenizationDiagnostic(diagnostic);

      if (shouldContinueToSubscribeAfterTokenize(diagnostic)) {
        recordSubmitStage("tokenize_success", { submitting: true });
      } else {
        recordSubmitStage("tokenize_failed", { submitting: true });
      }

      if (
        !shouldCallSubscribeEndpoint({
          diagnostic,
          diagnosticOnly,
        })
      ) {
        if (diagnosticOnly) {
          setEnrollmentPostBlocked(true);
          if (diagnostic.statusLabel !== "SUCCESS") {
            setError(
              diagnostic.safeErrorMessage ??
                "Card could not be tokenized. Please check your details.",
            );
          } else {
            setError(null);
          }
          recordSubmitStage("blocked_diagnosticOnly", { submitting: true });
          return;
        }
        setError(
          diagnostic.safeErrorMessage ??
            "Card could not be tokenized. Please check your details.",
        );
        recordSubmitStage("blocked_shouldCallSubscribe_false", {
          submitting: true,
        });
        return;
      }

      // Token value stays in this local only — never placed in diagnostic state.
      const sourceId = tokenResult.token!;

      let verificationToken: string | undefined;
      if (paymentsRef.current?.verifyBuyer) {
        try {
          const verification = await paymentsRef.current.verifyBuyer(sourceId, {
            amount: String(amountUsd),
            currencyCode: "USD",
            intent: "STORE",
            billingContact: cardholderName
              ? { givenName: cardholderName.split(/\s+/)[0] }
              : undefined,
          });
          verificationToken = verification.token;
        } catch {
          /* SCA optional when Square does not require it */
        }
      }

      // One-shot lock only when enrollment POST is about to run (not on tokenize/diagnostic exits).
      if (oneShotSubmit) {
        setSubmitLocked(true);
      }

      recordSubmitStage("ready_for_fetch", {
        submitting: true,
        submitLocked: oneShotSubmit ? true : submitLocked,
      });
      recordSubmitStage("fetch_started", {
        submitting: true,
        submitLocked: oneShotSubmit ? true : submitLocked,
      });
      reachedFetch = true;
      const response = await fetch("/api/payments/square/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentId,
          sourceId,
          verificationToken,
          cardholderName: cardholderName.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
          acceptedPaidTerms: true,
          consentVersion: PAID_BILLING_CONSENT_VERSION,
        }),
      });
      recordSubmitStage("fetch_response_received", {
        submitting: true,
        submitLocked: oneShotSubmit ? true : submitLocked,
      });
      const payload = (await response.json()) as
        | {
            ok: true;
            intentId: string;
            subscriptionId: string;
            status: string;
          }
        | { ok: false; error?: string };

      if (!payload.ok) {
        setError(formatSubscribeUserMessage(payload.error));
        if (showSafeSubscribeDiagnostics) {
          setSafeSubscribeErrorCode(
            resolveSafeSubscribeDiagnosticCode(payload.error),
          );
        }
        return;
      }

      setSafeSubscribeErrorCode(null);
      setSuccess({
        subscriptionId: payload.subscriptionId,
        status: payload.status,
      });
      onSuccess?.({
        intentId: payload.intentId,
        subscriptionId: payload.subscriptionId,
        status: payload.status,
      });
    } catch {
      if (!reachedFetch) {
        recordSubmitStage("tokenize_failed", { submitting: true });
        setTokenizationDiagnostic({
          resultStatus: null,
          statusLabel: "UNKNOWN",
          tokenCreated: "NO",
          safeErrorCode: null,
          safeErrorMessage: "Tokenization threw before a usable result",
          safeErrors: [],
        });
        if (diagnosticOnly) {
          setEnrollmentPostBlocked(true);
          recordSubmitStage("blocked_diagnosticOnly", { submitting: true });
        } else {
          recordSubmitStage("blocked_shouldCallSubscribe_false", {
            submitting: true,
          });
        }
      }
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/80 p-6 text-slate-100 shadow-xl shadow-sky-950/30">
      {showB4cSubmitTrace ? (
        <p
          className="mb-3 rounded-lg border border-fuchsia-500/40 bg-fuchsia-950/30 px-3 py-2 font-mono text-[11px] text-fuchsia-100"
          data-testid="b4c-submit-trace-build"
          role="status"
        >
          B4C TRACE BUILD: {B4C_SUBMIT_TRACE_BUILD}
          {lastSubmitStage ? (
            <>
              <br />
              B4C Submit Trace: {lastSubmitStage}
            </>
          ) : null}
        </p>
      ) : null}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400">
          Zencierge billing
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-white">
          {plan.name}
        </h2>
        <p className="text-sm text-slate-400">
          {billingLabel} · ${amountUsd}
          {billingCycle === "annual" ? "/year" : "/month"}
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <label className="block text-xs font-medium text-slate-300">
          Name on card
          <input
            value={cardholderName}
            onChange={(event) => setCardholderName(event.target.value)}
            autoComplete="cc-name"
            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-sky-500/40 focus:ring-2"
            placeholder="Full name"
          />
        </label>
        <label className="block text-xs font-medium text-slate-300">
          Postal code
          <input
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
            autoComplete="postal-code"
            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-sky-500/40 focus:ring-2"
            placeholder="10003"
          />
        </label>
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-300">Card</p>
          <div
            id="zencierge-square-card"
            className="min-h-[56px] rounded-xl border border-slate-700 bg-slate-900 px-3 py-3"
          />
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {showSafeSubscribeDiagnostics && safeSubscribeErrorCode ? (
        <p
          className="mt-2 font-mono text-xs text-amber-200/90"
          data-testid="safe-subscribe-diagnostic-code"
          role="status"
        >
          Sandbox diagnostic code: {safeSubscribeErrorCode}
        </p>
      ) : null}
      {success ? (
        <p className="mt-4 text-sm text-emerald-300" role="status">
          Subscription active ({success.status}).
        </p>
      ) : null}

      {showDiagnostics && tokenizationDiagnostic ? (
        <div
          className="mt-4 rounded-xl border border-amber-800/50 bg-amber-950/30 p-3 text-xs text-amber-100/90"
          data-testid="tokenization-diagnostic"
          role="status"
        >
          <p className="font-semibold uppercase tracking-wide text-amber-300/90">
            Tokenization diagnostic (sandbox)
          </p>
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between gap-3">
              <dt>Tokenization status</dt>
              <dd className="font-mono">{tokenizationDiagnostic.statusLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Token created</dt>
              <dd className="font-mono">{tokenizationDiagnostic.tokenCreated}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>result.status</dt>
              <dd className="font-mono">
                {tokenizationDiagnostic.resultStatus ?? "none"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Safe error code</dt>
              <dd className="font-mono">
                {tokenizationDiagnostic.safeErrorCode ?? "none"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt>Safe error message</dt>
              <dd className="font-mono text-[11px] text-amber-50/90">
                {tokenizationDiagnostic.safeErrorMessage ?? "none"}
              </dd>
            </div>
            {enrollmentPostBlocked || diagnosticOnly ? (
              <div className="flex justify-between gap-3">
                <dt>Enrollment POST</dt>
                <dd className="font-mono text-amber-200">
                  BLOCKED (diagnostic-only)
                </dd>
              </div>
            ) : null}
            {tokenizationDiagnostic.safeErrors.length > 1 ? (
              <div className="flex flex-col gap-0.5">
                <dt>Additional safe errors</dt>
                <dd className="font-mono text-[11px] text-amber-50/90">
                  {tokenizationDiagnostic.safeErrors
                    .slice(1)
                    .map((entry, index) => (
                      <span key={`${entry.code ?? "e"}-${index}`} className="block">
                        {[entry.code, entry.field, entry.message]
                          .filter(Boolean)
                          .join(" · ") || "none"}
                      </span>
                    ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void handleSubscribe()}
        disabled={
          enrollBlockedByDisable ||
          !ready ||
          submitting ||
          submitLocked ||
          Boolean(success)
          || !acceptedPaidTerms
        }
        className="mt-6 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enrollBlockedByDisable
          ? "Subscribe disabled (UI readiness)"
          : diagnosticOnly
            ? submitting
              ? "Diagnosing…"
              : "Diagnose tokenization"
            : submitting
              ? "Subscribing…"
              : submitLocked && !success
                ? "Submit locked"
                : success
                  ? "Subscribed"
                  : "Subscribe"}
      </button>
      <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-300">
        <input type="checkbox" checked={acceptedPaidTerms} onChange={(event) => setAcceptedPaidTerms(event.target.checked)} className="mt-0.5" />
        <span>I accept the displayed {billingLabel.toLowerCase()} price and authorize creation of the recurring subscription only when I press Subscribe.</span>
      </label>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Card details are tokenized by Square. Zencierge never receives your full
        card number or CVV.
      </p>
    </section>
  );
}
