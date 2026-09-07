import { properties } from "./dashboard-data";
import { askAvatarReply } from "./ask-avatar";
import { detectGuestIntent, isConnectionCheckUtterance } from "./receptionist-intent";
import { CONNECTION_CHECK_REPLY } from "./receptionist-replies";

const property = properties[0]!;

const EN_REPLY = "Yes, I can hear you. How can I help?";
const ES_REPLY = "Sí, puedo escucharte. ¿Cómo puedo ayudarte?";

const ENGLISH_PHRASES = [
  "Can you hear me?",
  "do you hear me",
  "are you able to hear me",
  "are you there",
  "hello, are you there",
];

const SPANISH_PHRASES = [
  "¿Me puedes escuchar?",
  "me escuchas",
  "puedes escucharme",
  "puedes oírme",
  "me oyes",
  "estás ahí",
  "hola, estás ahí",
];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function secretFragments() {
  return [property.wifiPassword, property.doorCode, property.gateCode, property.address]
    .filter((value) => value && value !== "—")
    .flatMap((value) => {
      const raw = value!;
      const stripped = raw.replace(/#/g, "").trim();
      return stripped && stripped !== raw ? [raw, stripped] : [raw];
    });
}

function assertNoSecrets(label: string, text: string) {
  const lower = text.toLowerCase();
  for (const secret of secretFragments()) {
    assert(!lower.includes(secret.toLowerCase()), `${label} leaked secret fragment`);
  }
  assert(!/handbook/i.test(text), `${label} mentioned handbook`);
}

async function run() {
  assert(CONNECTION_CHECK_REPLY.en === EN_REPLY, "English reply constant drifted");
  assert(CONNECTION_CHECK_REPLY.es === ES_REPLY, "Spanish reply constant drifted");

  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    setTimeout,
    clearTimeout,
    location: { hostname: "localhost", origin: "http://localhost" },
  };
  let avatarCalls = 0;
  let googleCalls = 0;
  let localGuideCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/avatar")) {
      avatarCalls += 1;
      return new Response(JSON.stringify({ reply: "LLM should not run" }), { status: 200 });
    }
    if (url.includes("/api/places/nearby") || url.includes("maps.googleapis.com") || url.includes("places.googleapis.com")) {
      googleCalls += 1;
      throw new Error("Google/places must not run for connection_check");
    }
    if (url.includes("/api/local-guide")) {
      localGuideCalls += 1;
      throw new Error("Local Guide must not run for connection_check");
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  for (const phrase of ENGLISH_PHRASES) {
    assert(isConnectionCheckUtterance(phrase), `expected connection_check: ${phrase}`);
    assert(detectGuestIntent(phrase) === "connection_check", `intent missed: ${phrase}`);
    const reply = await askAvatarReply({
      question: phrase,
      property,
      properties,
      language: "auto",
      lastUserLang: "es",
    });
    assert(reply.spokenText === EN_REPLY, `English spoken mismatch for: ${phrase}`);
    assert(reply.displayText === EN_REPLY, `English display mismatch for: ${phrase}`);
    assert(reply.source === "assistant", `source for ${phrase}`);
    assert(!reply.liveResults, `google results for ${phrase}`);
    assert(!reply.hostResults, `host results for ${phrase}`);
    assert(!/[áéíóúñ¿¡]/i.test(reply.spokenText), `English mixed Spanish for: ${phrase}`);
    assert(!reply.spokenText.includes("Sí"), `English mixed Sí for: ${phrase}`);
    assertNoSecrets(phrase, `${reply.spokenText} ${reply.displayText} ${JSON.stringify(reply)}`);
  }

  for (const phrase of SPANISH_PHRASES) {
    assert(isConnectionCheckUtterance(phrase), `expected connection_check: ${phrase}`);
    assert(detectGuestIntent(phrase) === "connection_check", `intent missed: ${phrase}`);
    const reply = await askAvatarReply({
      question: phrase,
      property,
      properties,
      language: "auto",
      lastUserLang: "en",
    });
    assert(reply.spokenText === ES_REPLY, `Spanish spoken mismatch for: ${phrase}`);
    assert(reply.displayText === ES_REPLY, `Spanish display mismatch for: ${phrase}`);
    assert(reply.source === "assistant", `source for ${phrase}`);
    assert(!reply.liveResults && !reply.hostResults, `external results for ${phrase}`);
    assert(!/\b(Yes|hear you|How can I help)\b/.test(reply.spokenText), `Spanish mixed English for: ${phrase}`);
    assertNoSecrets(phrase, `${reply.spokenText} ${JSON.stringify(reply)}`);
  }

  assert(avatarCalls === 0, `connection checks called avatar (${avatarCalls})`);
  assert(googleCalls === 0, `connection checks called Google (${googleCalls})`);
  assert(localGuideCalls === 0, `connection checks called Local Guide (${localGuideCalls})`);

  assert(!isConnectionCheckUtterance("can you hear the neighbors"), "broad hear match");
  assert(!isConnectionCheckUtterance("are you there for check-out"), "broad are-you-there match");
  assert(detectGuestIntent("What is the Wi-Fi password?") === "wifi", "wifi intent changed");
  assert(detectGuestIntent("What time is check-out?") === "checkin", "checkout intent changed");

  const general = await askAvatarReply({
    question: "What is a good day trip from here?",
    property,
    properties,
    language: "en",
    lastUserLang: "en",
  });
  assert(avatarCalls === 1, `unrelated question skipped avatar (calls=${avatarCalls})`);
  assert(general.spokenText === "LLM should not run", "unrelated question did not use avatar reply");
  assert(googleCalls === 0, "unrelated question called Google");
  assert(localGuideCalls === 0, "unrelated question called Local Guide");

  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window: unknown }).window = originalWindow;
  }
}

const isDirectRun = process.argv[1]?.includes("connection-check");
if (isDirectRun) {
  run()
    .then(() => {
      console.log("connection-check tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "connection-check tests failed");
      process.exitCode = 1;
    });
}

export { run as runConnectionCheckTests };
