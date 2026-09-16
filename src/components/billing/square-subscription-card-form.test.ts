import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatSubscribeUserMessage,
  resolveSafeSubscribeDiagnosticCode,
  shouldCallSubscribeEndpoint,
  shouldContinueToSubscribeAfterTokenize,
  summarizeSquareTokenizationResult,
} from "./square-subscription-card-form";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runSquareSubscriptionCardFormTests() {
  const source = readFileSync(
    join(__dirname, "square-subscription-card-form.tsx"),
    "utf8",
  );
  const clientSource = readFileSync(
    join(
      __dirname,
      "../../app/dev/square-subscription-test/square-subscription-test-client.tsx",
    ),
    "utf8",
  );

  // tokenize success with token
  {
    const diagnostic = summarizeSquareTokenizationResult({
      status: "OK",
      token: "cnon:card-nonce-ok-SHOULD-NOT-LEAK",
    });
    assert(diagnostic.statusLabel === "SUCCESS", "success status label");
    assert(diagnostic.tokenCreated === "YES", "token created yes");
    assert(diagnostic.resultStatus === "OK", "result status OK");
    assert(diagnostic.safeErrorCode === null, "no error code on success");
    assert(diagnostic.safeErrorMessage === null, "no error message on success");
    assert(
      shouldContinueToSubscribeAfterTokenize(diagnostic),
      "continue to subscribe on success",
    );
    assert(
      shouldCallSubscribeEndpoint({ diagnostic, diagnosticOnly: false }),
      "default mode may call subscribe on success",
    );
    assert(
      !shouldCallSubscribeEndpoint({ diagnostic, diagnosticOnly: true }),
      "diagnosticOnly + successful tokenize does NOT call subscribe",
    );
    assert(
      !JSON.stringify(diagnostic).includes("cnon:"),
      "success diagnostic must not embed token value",
    );
  }

  // Success status alias
  {
    const diagnostic = summarizeSquareTokenizationResult({
      status: "Success",
      token: "tok_secret_value_xyz",
    });
    assert(diagnostic.statusLabel === "SUCCESS", "Success alias maps to SUCCESS");
    assert(diagnostic.tokenCreated === "YES", "token present");
    assert(
      !JSON.stringify(diagnostic).includes("tok_secret"),
      "token value not in diagnostic",
    );
  }

  // tokenize failure with safe error
  {
    const diagnostic = summarizeSquareTokenizationResult({
      status: "Invalid",
      errors: [
        {
          code: "VERIFY_CVV",
          message: "CVV is invalid",
          field: "cvv",
        },
      ],
    });
    assert(diagnostic.statusLabel === "FAILURE", "failure status label");
    assert(diagnostic.tokenCreated === "NO", "no token on failure");
    assert(diagnostic.resultStatus === "Invalid", "raw status preserved safely");
    assert(diagnostic.safeErrorCode === "VERIFY_CVV", "safe error code");
    assert(
      diagnostic.safeErrorMessage === "CVV is invalid",
      "safe error message",
    );
    assert(diagnostic.safeErrors[0]?.field === "cvv", "safe field");
    assert(
      !shouldContinueToSubscribeAfterTokenize(diagnostic),
      "do not subscribe on failure",
    );
    assert(
      !shouldCallSubscribeEndpoint({ diagnostic, diagnosticOnly: true }),
      "diagnosticOnly + failed tokenize does NOT call subscribe",
    );
    assert(
      !shouldCallSubscribeEndpoint({ diagnostic, diagnosticOnly: false }),
      "failed tokenize does not call subscribe in default mode either",
    );
  }

  // tokenize result with no token
  {
    const diagnostic = summarizeSquareTokenizationResult({
      status: "OK",
      token: "",
      errors: [{ code: "MISSING_TOKEN", message: "No payment token returned" }],
    });
    assert(diagnostic.statusLabel === "FAILURE", "OK without token is failure");
    assert(diagnostic.tokenCreated === "NO", "empty token => NO");
    assert(
      !shouldContinueToSubscribeAfterTokenize(diagnostic),
      "no subscribe without token",
    );
  }

  // multiple errors sanitized
  {
    const diagnostic = summarizeSquareTokenizationResult({
      status: "Error",
      token: "cnon:abc123leak",
      errors: [
        {
          code: "INVALID_CARD",
          message: "Card declined; nonce cnon:abc123leak",
          field: "cardNumber",
        },
        {
          code: "INVALID_EXPIRATION",
          message: "Expiration year is invalid",
          field: "expirationYear",
        },
      ],
    });
    assert(diagnostic.safeErrors.length === 2, "both errors kept");
    assert(diagnostic.safeErrorCode === "INVALID_CARD", "first code");
    assert(
      Boolean(diagnostic.safeErrorMessage?.includes("[redacted]")),
      "token-like text redacted from message",
    );
    assert(
      !diagnostic.safeErrorMessage?.includes("cnon:abc123leak"),
      "raw nonce not in message",
    );
    assert(
      diagnostic.safeErrors[1]?.code === "INVALID_EXPIRATION",
      "second code preserved",
    );
    assert(
      !JSON.stringify(diagnostic).includes("cnon:abc123leak"),
      "no raw token in diagnostic JSON",
    );
  }

  // unknown / null result
  {
    const diagnostic = summarizeSquareTokenizationResult(null);
    assert(diagnostic.statusLabel === "UNKNOWN", "null => UNKNOWN");
    assert(diagnostic.tokenCreated === "NO", "null => no token");
    assert(
      !shouldContinueToSubscribeAfterTokenize(diagnostic),
      "no subscribe on unknown",
    );
  }

  // PAN-like digits redacted
  {
    const diagnostic = summarizeSquareTokenizationResult({
      status: "Error",
      errors: [
        {
          code: "BAD_NUMBER",
          message: "Number 4111111111111111 rejected",
        },
      ],
    });
    assert(
      !diagnostic.safeErrorMessage?.includes("4111111111111111"),
      "PAN digits redacted",
    );
    assert(
      Boolean(diagnostic.safeErrorMessage?.includes("[redacted]")),
      "PAN replaced with redacted",
    );
  }

  // Safe subscribe diagnostic visibility (B4C only)
  {
    assert(
      resolveSafeSubscribeDiagnosticCode("customer_failed") === "customer_failed",
      "customer_failed is visible as diagnostic code",
    );
    assert(
      formatSubscribeUserMessage("customer_failed") ===
        "Unable to complete subscription enrollment.",
      "customer_failed keeps generic friendly text",
    );
    assert(
      formatSubscribeUserMessage("card_failed") ===
        "Card could not be saved. Please try again.",
      "card_failed keeps existing friendly text",
    );
    assert(
      formatSubscribeUserMessage("subscription_failed") ===
        "Subscription could not be started. Please try again.",
      "subscription_failed keeps existing friendly text",
    );
    assert(
      resolveSafeSubscribeDiagnosticCode("cnon:secret") === null,
      "non-allowlisted values are not shown",
    );
    assert(
      source.includes("showSafeSubscribeDiagnostics"),
      "form has showSafeSubscribeDiagnostics prop",
    );
    assert(
      source.includes("Sandbox diagnostic code:"),
      "sandbox diagnostic label present",
    );
    assert(
      source.includes("safe-subscribe-diagnostic-code"),
      "diagnostic test id present",
    );
    assert(
      source.includes("showSafeSubscribeDiagnostics && safeSubscribeErrorCode"),
      "diagnostic render gated on B4C prop",
    );
    assert(
      source.includes("showSafeSubscribeDiagnostics = false"),
      "production default keeps diagnostics off",
    );
    assert(
      clientSource.includes("showSafeSubscribeDiagnostics"),
      "B4C client enables safe subscribe diagnostics",
    );
  }

  // B4C submit trace (dev-only; no token exposure)
  {
    assert(
      source.includes("showB4cSubmitTrace = false"),
      "submit trace defaults off for production callers",
    );
    assert(
      source.includes("B4C_SUBMIT_TRACE_BUILD"),
      "trace build constant exported",
    );
    assert(
      source.includes('B4C TRACE BUILD: {B4C_SUBMIT_TRACE_BUILD}') ||
        source.includes("B4C TRACE BUILD:"),
      "trace build marker rendered when enabled",
    );
    assert(
      source.includes("recordSubmitStage"),
      "submit stages recorded via helper",
    );
    for (const stage of [
      "click_received",
      "blocked_disableEnroll",
      "blocked_no_card_ref",
      "blocked_submitting",
      "blocked_submitLocked",
      "tokenize_started",
      "tokenize_failed",
      "tokenize_success",
      "blocked_diagnosticOnly",
      "blocked_shouldCallSubscribe_false",
      "ready_for_fetch",
      "fetch_started",
      "fetch_response_received",
    ]) {
      assert(source.includes(`"${stage}"`), `stage ${stage} present`);
    }
    assert(
      clientSource.includes("B4C TRACE BUILD"),
      "B4C page shows TRACE BUILD marker",
    );
    assert(
      clientSource.includes("B4C Submit Trace"),
      "B4C page shows submit trace",
    );
    assert(
      clientSource.includes("authorizedIntentMatch"),
      "B4C page shows authorizedIntentMatch",
    );
    assert(
      clientSource.includes("showB4cSubmitTrace"),
      "B4C client enables submit trace",
    );
    assert(
      !source.includes("console.log(sourceId"),
      "trace must not console.log sourceId",
    );
  }

  // Source contract: diagnosticOnly blocks subscribe; token values not logged
  {
    assert(
      source.includes("summarizeSquareTokenizationResult"),
      "form uses summarize helper",
    );
    assert(
      source.includes("shouldCallSubscribeEndpoint"),
      "form gates subscribe on shouldCallSubscribeEndpoint",
    );
    assert(source.includes("diagnosticOnly"), "diagnosticOnly prop present");
    assert(
      source.includes("BLOCKED (diagnostic-only)"),
      "UI shows enrollment POST blocked label",
    );
    assert(
      source.includes("tokenization-diagnostic"),
      "sandbox diagnostic panel present",
    );
    assert(
      source.includes('"/api/payments/square/subscribe"'),
      "subscribe route still referenced for non-diagnostic success path",
    );

    const tokenizeStart = source.indexOf(
      "const tokenResult = await cardRef.current.tokenize()",
    );
    const subscribeStart = source.indexOf('"/api/payments/square/subscribe"');
    assert(tokenizeStart >= 0 && subscribeStart > tokenizeStart, "tokenize before subscribe");
    const tokenizeBlock = source.slice(tokenizeStart, subscribeStart);
    assert(
      tokenizeBlock.includes("shouldCallSubscribeEndpoint"),
      "gate appears before subscribe fetch",
    );
    assert(
      tokenizeBlock.includes("diagnosticOnly"),
      "diagnosticOnly checked before subscribe fetch",
    );
    assert(tokenizeBlock.includes("return;"), "early return before subscribe");
    assert(
      !source.includes("console.log(tokenResult"),
      "does not console.log tokenResult",
    );
    assert(!source.includes("console.log(token"), "does not console.log token");
    assert(
      !source.includes("setTokenizationDiagnostic(tokenResult"),
      "does not store raw tokenize result in state",
    );
    assert(
      !source.includes("JSON.stringify(tokenResult)"),
      "does not stringify raw tokenize result",
    );
    assert(
      clientSource.includes("diagnosticOnly"),
      "B4C client enables diagnosticOnly",
    );
  }

  // One-shot lock ordering: only lock immediately before enroll POST
  {
    const handleStart = source.indexOf("async function handleSubscribe()");
    const fetchStart = source.indexOf('"/api/payments/square/subscribe"');
    assert(handleStart >= 0 && fetchStart > handleStart, "handle before fetch");
    const handleBody = source.slice(handleStart, fetchStart);
    const tokenizeAt = handleBody.indexOf(
      "const tokenResult = await cardRef.current.tokenize()",
    );
    const gateAt = handleBody.indexOf("shouldCallSubscribeEndpoint");
    const lockAt = handleBody.indexOf("setSubmitLocked(true)");
    assert(tokenizeAt >= 0, "tokenize present");
    assert(gateAt > tokenizeAt, "gate after tokenize");
    assert(lockAt > gateAt, "lock after shouldCallSubscribeEndpoint");
    assert(
      handleBody.lastIndexOf("setSubmitLocked(true)") === lockAt,
      "exactly one setSubmitLocked(true) before fetch",
    );
    const beforeTokenize = handleBody.slice(0, tokenizeAt);
    assert(
      !beforeTokenize.includes("setSubmitLocked(true)"),
      "tokenization failure path does not pre-lock (no lock before tokenize)",
    );
    const betweenTokenizeAndGate = handleBody.slice(tokenizeAt, gateAt);
    assert(
      !betweenTokenizeAndGate.includes("setSubmitLocked(true)"),
      "diagnosticOnly / pre-gate exits do not lock",
    );
    const betweenGateAndFetch = handleBody.slice(gateAt, handleBody.length);
    assert(
      betweenGateAndFetch.includes("if (oneShotSubmit)") &&
        betweenGateAndFetch.includes("setSubmitLocked(true)"),
      "successful POST path locks immediately before fetch",
    );
    assert(
      source.includes('recordSubmitStage("blocked_submitLocked")') &&
        source.includes("if (submitLocked)"),
      "second click remains blocked while submitLocked",
    );
    assert(
      source.includes("submitLocked ||") && source.includes("Boolean(success)"),
      "button disabled when locked after real POST path",
    );
  }

  console.log("square-subscription-card-form tests passed");
}

void runSquareSubscriptionCardFormTests();
