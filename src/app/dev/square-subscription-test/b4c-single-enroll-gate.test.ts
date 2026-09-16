import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  B4C_AUTHORIZED_ENROLL_INTENT_ID,
  resolveB4cSingleEnrollAllowed,
} from "./b4c-single-enroll-gate";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const OWNER = "5d070dd6-ed82-4036-b38c-37d3b8a1df0c";
const OTHER = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-09-15T18:00:00.000Z");
const FUTURE = "2026-09-15T22:00:00.000Z";
const PAST = "2026-09-15T10:00:00.000Z";

function baseOk(
  overrides: Partial<Parameters<typeof resolveB4cSingleEnrollAllowed>[0]> = {},
) {
  return resolveB4cSingleEnrollAllowed({
    nodeEnv: "development",
    squareEnvironment: "sandbox",
    intentId: B4C_AUTHORIZED_ENROLL_INTENT_ID,
    sessionUserId: OWNER,
    intentOwnerUserId: OWNER,
    intentStatus: "pending",
    expiresAt: FUTURE,
    nowMs: NOW,
    ...overrides,
  });
}

export function runB4cSingleEnrollGateTests() {
  // allowed: dev + sandbox + owner match + authorized live intent
  {
    const result = baseOk();
    assert(result.allowed === true, "happy path allowed");
    assert(result.reason === "ok", "happy path reason");
  }

  // production blocked
  {
    const result = baseOk({ nodeEnv: "production" });
    assert(result.allowed === false, "production blocked");
    assert(result.reason === "production", "production reason");
  }

  // no session blocked
  {
    const result = baseOk({ sessionUserId: null });
    assert(result.allowed === false, "no session blocked");
    assert(result.reason === "no_session", "no session reason");
  }

  // wrong owner blocked
  {
    const result = baseOk({ sessionUserId: OTHER });
    assert(result.allowed === false, "wrong owner blocked");
    assert(result.reason === "session_owner_mismatch", "wrong owner reason");
  }

  // wrong intent blocked
  {
    const result = baseOk({
      intentId: "2a4ac916-112f-45a9-809d-ecc0f8024017",
    });
    assert(result.allowed === false, "wrong intent blocked");
    assert(result.reason === "intent_not_authorized", "wrong intent reason");
  }

  // expired by status blocked
  {
    const result = baseOk({ intentStatus: "expired" });
    assert(result.allowed === false, "expired status blocked");
    assert(
      result.reason === "intent_terminal_or_expired",
      "expired status reason",
    );
  }

  // completed terminal blocked
  {
    const result = baseOk({ intentStatus: "completed" });
    assert(result.allowed === false, "completed blocked");
    assert(
      result.reason === "intent_terminal_or_expired",
      "completed reason",
    );
  }

  // expired by expires_at blocked
  {
    const result = baseOk({ expiresAt: PAST });
    assert(result.allowed === false, "past expires_at blocked");
    assert(result.reason === "intent_expired", "past expires reason");
  }

  // non-sandbox blocked
  {
    const result = baseOk({ squareEnvironment: "production" });
    assert(result.allowed === false, "square production blocked");
    assert(result.reason === "square_env_not_sandbox", "square env reason");
  }

  // Source contracts
  {
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const client = readFileSync(
      join(__dirname, "square-subscription-test-client.tsx"),
      "utf8",
    );
    const form = readFileSync(
      join(
        __dirname,
        "../../../components/billing/square-subscription-card-form.tsx",
      ),
      "utf8",
    );

    assert(
      page.includes("resolveB4cSingleEnrollAllowed"),
      "page uses pure gate",
    );
    assert(
      page.includes("Sandbox B4C only — one controlled enrollment attempt."),
      "page warning present",
    );
    assert(
      client.includes("diagnosticOnly={diagnosticOnly}") ||
        client.includes("diagnosticOnly={!liveEnroll}"),
      "diagnosticOnly only when live enroll closed",
    );
    assert(
      client.includes("oneShotSubmit={liveEnroll}"),
      "one-shot submit when live enroll open",
    );
    assert(
      client.includes("Sandbox B4C only — one controlled enrollment attempt."),
      "client warning present",
    );
    assert(form.includes("oneShotSubmit"), "form supports oneShotSubmit");
    assert(form.includes("submitLocked"), "form locks after first click");
    assert(
      form.includes('"/api/payments/square/subscribe"'),
      "subscribe path still present for live enroll",
    );

    // One-shot: lock only immediately before enroll POST (not before tokenize)
    const handleStart = form.indexOf("async function handleSubscribe()");
    const fetchStart = form.indexOf('"/api/payments/square/subscribe"');
    assert(handleStart >= 0 && fetchStart > handleStart, "handle before fetch");
    const handleBody = form.slice(handleStart, fetchStart);
    const tokenizeAt = handleBody.indexOf(
      "const tokenResult = await cardRef.current.tokenize()",
    );
    const gateAt = handleBody.indexOf("shouldCallSubscribeEndpoint");
    const lockAt = handleBody.indexOf("setSubmitLocked(true)");
    assert(tokenizeAt >= 0, "tokenize in handleSubscribe");
    assert(gateAt > tokenizeAt, "subscribe gate after tokenize");
    assert(
      lockAt > gateAt && lockAt > tokenizeAt,
      "one-shot lock after tokenize + shouldCallSubscribeEndpoint",
    );
    assert(
      handleBody.includes("if (oneShotSubmit)") && lockAt >= 0,
      "one-shot lock set before subscribe fetch",
    );
    assert(
      handleBody.includes("submitLocked"),
      "submitLocked checked before work",
    );
    const earlySection = handleBody.slice(0, tokenizeAt);
    assert(
      !earlySection.includes("setSubmitLocked(true)"),
      "one-shot must not lock before tokenize",
    );
  }

  console.log("b4c-single-enroll-gate tests passed");
}

void runB4cSingleEnrollGateTests();
