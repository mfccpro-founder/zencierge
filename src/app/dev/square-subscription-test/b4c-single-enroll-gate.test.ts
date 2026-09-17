import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readSquareB4cAuthorizedIntentIdFromEnv,
  resolveB4cSingleEnrollAllowed,
  resolveSquareB4cAuthorizedIntentId,
  SQUARE_B4C_AUTHORIZED_INTENT_ENV,
} from "./b4c-single-enroll-gate";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const AUTHORIZED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "11111111-1111-4111-8111-111111111111";
const WRONG_INTENT = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-09-15T18:00:00.000Z");
const FUTURE = "2026-09-15T22:00:00.000Z";
const PAST = "2026-09-15T10:00:00.000Z";

function baseOk(
  overrides: Partial<Parameters<typeof resolveB4cSingleEnrollAllowed>[0]> = {},
) {
  return resolveB4cSingleEnrollAllowed({
    nodeEnv: "development",
    squareEnvironment: "sandbox",
    intentId: AUTHORIZED,
    authorizedIntentId: AUTHORIZED,
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
      intentId: WRONG_INTENT,
    });
    assert(result.allowed === false, "wrong intent blocked");
    assert(result.reason === "intent_not_authorized", "wrong intent reason");
  }

  // missing authorized config blocked
  {
    const result = baseOk({ authorizedIntentId: null });
    assert(result.allowed === false, "missing authorized config blocked");
    assert(
      result.reason === "authorized_intent_unconfigured",
      "missing authorized config reason",
    );
  }

  // blank authorized config blocked
  {
    const result = baseOk({ authorizedIntentId: "   " });
    assert(result.allowed === false, "blank authorized config blocked");
    assert(
      result.reason === "authorized_intent_unconfigured",
      "blank authorized config reason",
    );
  }

  // malformed authorized config blocked
  {
    const result = baseOk({ authorizedIntentId: "not-a-uuid" });
    assert(result.allowed === false, "malformed authorized config blocked");
    assert(
      result.reason === "authorized_intent_unconfigured",
      "malformed authorized config reason",
    );
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

  {
    assert(
      resolveSquareB4cAuthorizedIntentId(undefined) === null,
      "undefined env is closed",
    );
    assert(
      resolveSquareB4cAuthorizedIntentId("") === null,
      "empty env is closed",
    );
    assert(
      resolveSquareB4cAuthorizedIntentId("  not-uuid  ") === null,
      "malformed env is closed",
    );
    assert(
      resolveSquareB4cAuthorizedIntentId(`  ${AUTHORIZED.toUpperCase()}  `) ===
        AUTHORIZED,
      "valid env trims and lowercases",
    );
    assert(
      readSquareB4cAuthorizedIntentIdFromEnv({}) === null,
      "missing env key is closed",
    );
    assert(
      readSquareB4cAuthorizedIntentIdFromEnv({
        [SQUARE_B4C_AUTHORIZED_INTENT_ENV]: AUTHORIZED,
      }) === AUTHORIZED,
      "env reader uses server-only key",
    );
    assert(
      SQUARE_B4C_AUTHORIZED_INTENT_ENV === "SQUARE_B4C_AUTHORIZED_INTENT_ID",
      "env name is SQUARE_B4C_AUTHORIZED_INTENT_ID",
    );
    assert(
      !SQUARE_B4C_AUTHORIZED_INTENT_ENV.startsWith("NEXT_PUBLIC_"),
      "env is not NEXT_PUBLIC",
    );
  }

  // Source contracts
  {
    const gate = readFileSync(join(__dirname, "b4c-single-enroll-gate.ts"), "utf8");
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
      !gate.includes("B4C_AUTHORIZED_ENROLL_INTENT_ID"),
      "gate has no hardcoded authorized constant",
    );
    assert(
      gate.includes('throw new Error("b4c-single-enroll-gate is server-only")'),
      "gate is server-only",
    );
    assert(
      page.includes("readSquareB4cAuthorizedIntentIdFromEnv"),
      "page reads authorized id from env",
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
      !client.includes("b4c-single-enroll-gate"),
      "client does not import server gate",
    );
    assert(
      !client.includes("SQUARE_B4C_AUTHORIZED_INTENT_ID"),
      "client does not mention env var",
    );
    assert(
      client.includes("authorizedIntentMatch?: boolean"),
      "client receives authorizedIntentMatch as a server boolean",
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
