"use client";

import { useState } from "react";
import {
  B4C_SUBMIT_TRACE_BUILD,
  SquareSubscriptionCardForm,
  type B4cSubmitTraceSnapshot,
} from "@/components/billing/square-subscription-card-form";
import type { BillingCycle, ZenciergePlanId } from "@/lib/zencierge-plans";

export type B4cAuthorizedIntentCatalog = {
  planId: ZenciergePlanId;
  billingCycle: BillingCycle;
  amountUsd: number;
  displayLabel: string;
};

export function SquareSubscriptionTestClient({
  intentId,
  catalog,
  enrollEnabled = false,
  singleEnrollEnabled = false,
  authorizedIntentMatch = false,
}: {
  intentId: string;
  catalog: B4cAuthorizedIntentCatalog | null;
  enrollEnabled?: boolean;
  /** When true, diagnosticOnly is off — one real sandbox subscribe POST is allowed. */
  singleEnrollEnabled?: boolean;
  authorizedIntentMatch?: boolean;
}) {
  const [webPaymentsReady, setWebPaymentsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<
    "pending" | "ok" | "fail"
  >("pending");
  const [enrollResult, setEnrollResult] = useState<{
    intentId: string;
    subscriptionId: string;
    status: string;
  } | null>(null);
  const [submitTrace, setSubmitTrace] = useState<B4cSubmitTraceSnapshot | null>(
    null,
  );

  const liveEnroll = Boolean(enrollEnabled && singleEnrollEnabled && catalog);
  const diagnosticOnly = !liveEnroll;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Live status
        </p>
        <ul className="mt-2 space-y-1 text-slate-300">
          <li>
            Public config route:{" "}
            <StatusBadge
              ok={configStatus === "ok"}
              pending={configStatus === "pending"}
              label={
                configStatus === "ok"
                  ? "sandbox config loaded"
                  : configStatus === "fail"
                    ? "failed"
                    : "checking…"
              }
            />
          </li>
          <li>
            Web Payments init:{" "}
            <StatusBadge
              ok={webPaymentsReady}
              pending={!webPaymentsReady && !initError}
              label={
                webPaymentsReady
                  ? "card field ready"
                  : initError
                    ? "failed"
                    : "initializing…"
              }
            />
          </li>
          <li>
            Authorized plan:{" "}
            <span className={catalog ? "text-emerald-300" : "text-amber-300"}>
              {catalog ? catalog.displayLabel : "unavailable"}
            </span>
          </li>
          <li>
            Enroll submit:{" "}
            <span className={liveEnroll ? "text-emerald-300" : "text-amber-300"}>
              {liveEnroll
                ? "unlocked — one controlled Subscribe"
                : "blocked (diagnostic-only — no subscribe POST)"}
            </span>
          </li>
        </ul>
        <p className="mt-3 text-sm font-semibold text-amber-200" role="status">
          Sandbox B4C only — one controlled enrollment attempt.
        </p>
        {initError ? (
          <p className="mt-3 text-sm text-rose-300" role="alert">
            {initError}
          </p>
        ) : null}
        {enrollResult ? (
          <p className="mt-3 text-sm text-emerald-300" role="status">
            Enrolled · intent {enrollResult.intentId} · sub{" "}
            {enrollResult.subscriptionId} · {enrollResult.status}
          </p>
        ) : null}
      </section>

      <section
        className="rounded-2xl border border-fuchsia-500/50 bg-fuchsia-950/20 p-4 text-sm text-fuchsia-50"
        data-testid="b4c-submit-trace-panel"
        role="status"
      >
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-fuchsia-300">
          B4C TRACE BUILD: {B4C_SUBMIT_TRACE_BUILD}
        </p>
        <p className="mt-2 font-mono text-xs">
          B4C Submit Trace:{" "}
          <span className="text-fuchsia-100">
            {submitTrace?.stage ?? "(none yet — click Subscribe)"}
          </span>
        </p>
        <ul className="mt-3 grid gap-1 font-mono text-[11px] text-fuchsia-100/90 sm:grid-cols-2">
          <li>cardReady: {String(submitTrace?.cardReady ?? webPaymentsReady)}</li>
          <li>submitting: {String(submitTrace?.submitting ?? false)}</li>
          <li>submitLocked: {String(submitTrace?.submitLocked ?? false)}</li>
          <li>diagnosticOnly: {String(submitTrace?.diagnosticOnly ?? diagnosticOnly)}</li>
          <li>liveEnroll: {String(liveEnroll)}</li>
          <li>enrollEnabled: {String(enrollEnabled)}</li>
          <li>singleEnrollEnabled: {String(singleEnrollEnabled)}</li>
          <li>authorizedIntentMatch: {String(authorizedIntentMatch)}</li>
        </ul>
      </section>

      {catalog ? (
        <SquareSubscriptionCardForm
          intentId={intentId}
          planId={catalog.planId}
          billingCycle={catalog.billingCycle}
          amountUsd={catalog.amountUsd}
          disableEnroll={!enrollEnabled}
          showTokenizationDiagnostics
          diagnosticOnly={diagnosticOnly}
          oneShotSubmit={liveEnroll}
          oneShotUnlockKey={liveEnroll ? "b4c-host-rpc-retry-1" : ""}
          showSafeSubscribeDiagnostics
          showB4cSubmitTrace
          onSubmitTraceChange={setSubmitTrace}
          onReady={() => {
            setConfigStatus("ok");
            setWebPaymentsReady(true);
            setInitError(null);
          }}
          onInitError={(message) => {
            setConfigStatus("fail");
            setWebPaymentsReady(false);
            setInitError(message);
          }}
          onSuccess={(result) => {
            setEnrollResult(result);
          }}
        />
      ) : (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-4 text-sm text-amber-100">
          Card form closed — authorized intent plan could not be validated.
        </p>
      )}
    </div>
  );
}

function StatusBadge({
  ok,
  pending,
  label,
}: {
  ok: boolean;
  pending: boolean;
  label: string;
}) {
  const tone = ok
    ? "text-emerald-300"
    : pending
      ? "text-slate-400"
      : "text-rose-300";
  return <span className={tone}>{label}</span>;
}
