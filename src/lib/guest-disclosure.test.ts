import { properties } from "./dashboard-data";
import { buildAvatarSystemPrompt } from "./avatar-prompt";
import {
  askAvatarReply,
  conciergeSpokenText,
  GOOGLE_NEARBY_SPOKEN,
  type ConciergeReply,
} from "./ask-avatar";
import { GOOGLE_MAPS_TEXT_ATTRIBUTION } from "../components/dashboard/google-maps-live-results";
import { runLocalGuideSharedTests } from "./local-guide-shared.test";
import {
  detectGuestIntent,
  extractGuestUtterance,
  relevantHandbookSnippet,
} from "./receptionist-intent";
import { answerGuestQuestion } from "./receptionist-replies";

const PREFIX =
  "Automatically detect the language of the guest's last message and answer only in that language (Spanish if they spoke Spanish, English if they spoke English). Never reply in the other language.\n\nGuest: ";

const property = properties[0]!;

const GOOGLE_SPOKEN_EN = "I found nearby options and displayed them on your screen.";
const GOOGLE_SPOKEN_ES = "Encontré opciones cercanas y las puse en tu pantalla.";

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
}

function assertNoGoogleContentInSpeech(label: string, spoken: string, names: string[]) {
  const lower = spoken.toLowerCase();
  assert(!/https?:\/\//i.test(spoken), `${label} spokenText included a URL`);
  assert(!/\bmiles?\b/i.test(spoken), `${label} spokenText included mileage`);
  assert(!/\d+\.\d+,\s*-?\d+/.test(spoken), `${label} spokenText included coordinates`);
  for (const name of names) {
    assert(!lower.includes(name.toLowerCase()), `${label} spokenText included Google business name`);
  }
  assertNoSecrets(label, spoken);
}

function widgetAudioPath(reply: ConciergeReply) {
  return conciergeSpokenText(reply);
}

function conciergeAudioPath(reply: ConciergeReply) {
  return conciergeSpokenText(reply);
}

function reply(question: string) {
  return answerGuestQuestion({
    question,
    properties,
    fallback: property,
    language: "en",
  });
}

function assertNoMix(reply: ConciergeReply, label: string) {
  const hasHost = Boolean(reply.hostResults?.length);
  const hasLive = Boolean(reply.liveResults?.length);
  assert(!(hasHost && hasLive), `${label} mixed hostResults and liveResults`);
  if (reply.source === "host") assert(!reply.liveResults, `${label} host source included liveResults`);
  if (reply.source === "google") assert(!reply.hostResults, `${label} google source included hostResults`);
}

export async function runGuestDisclosureTests() {
  runLocalGuideSharedTests();

  const pharmacyQ = `${PREFIX}Where is a nearby pharmacy?`;
  assert(extractGuestUtterance(pharmacyQ) === "Where is a nearby pharmacy?", "prefix strip failed");
  assert(detectGuestIntent(pharmacyQ) === "pharmacy", "pharmacy intent failed");
  const pharmacy = reply(pharmacyQ);
  assert(/live nearby-place lookup/i.test(pharmacy), "pharmacy should admit no live lookup");
  assert(!/cvs|walgreens|publix/i.test(pharmacy), "pharmacy invented a business");
  assertNoSecrets("pharmacy", pharmacy);

  const restaurant = reply("Recommend a restaurant.");
  assert(detectGuestIntent("Recommend a restaurant.") === "restaurant", "restaurant intent failed");
  assert(/live nearby-place lookup/i.test(restaurant), "restaurant should admit no live lookup");
  assert(!/sandwicherie|bodega|joe's stone/i.test(restaurant), "restaurant invented a venue");
  assertNoSecrets("restaurant", restaurant);

  const wifi = reply("What is the Wi-Fi password?");
  assert(detectGuestIntent("What is the Wi-Fi password?") === "wifi", "wifi intent failed");
  assert(/reservation is verified/i.test(wifi), "wifi should require verification");
  assertNoSecrets("wifi", wifi);

  const door = reply("What is the door code?");
  assert(detectGuestIntent("What is the door code?") === "door", "door intent failed");
  assert(/reservation is verified/i.test(door), "door should require verification");
  assertNoSecrets("door", door);

  const checkout = reply("What time is check-out?");
  assert(detectGuestIntent("What time is check-out?") === "checkin", "check-out intent failed");
  assert(/check-out/i.test(checkout), "check-out should answer the time");
  assertNoSecrets("checkout", checkout);

  const handbookHit = relevantHandbookSnippet(pharmacyQ, property.handbook);
  assert(!handbookHit || !/wifi|password|door code/i.test(handbookHit), "handbook snippet pulled access copy");

  const nearbyPrompt = buildAvatarSystemPrompt({
    property,
    emergencyNumber: "+1 (000) 000-0000",
    intent: "pharmacy",
    guestText: "Where is a nearby pharmacy?",
  });
  assertNoSecrets("nearby prompt", nearbyPrompt);
  assert(!nearbyPrompt.toLowerCase().includes("ai handbook"), "nearby prompt included handbook block");

  const generalPrompt = buildAvatarSystemPrompt({
    property,
    emergencyNumber: "+1 (000) 000-0000",
    intent: "checkin",
    guestText: "What time is check-out?",
  });
  assertNoSecrets("general prompt", generalPrompt);
  assert(!generalPrompt.includes(property.wifiNetwork), "general check-in prompt should not need the wifi network");

  assert(GOOGLE_NEARBY_SPOKEN.en === GOOGLE_SPOKEN_EN, "English Google spoken line drifted");
  assert(GOOGLE_NEARBY_SPOKEN.es === GOOGLE_SPOKEN_ES, "Spanish Google spoken line drifted");
  assert(GOOGLE_MAPS_TEXT_ATTRIBUTION.text === "Google Maps", "attribution text must stay Google Maps");
  assert(GOOGLE_MAPS_TEXT_ATTRIBUTION.translate === "no", "attribution must set translate=no");

  const originalFetch = globalThis.fetch;
  let avatarCalls = 0;
  let placesCalls = 0;
  let googleHttpCalls = 0;

  const hostGuidePayload = {
    source: "host",
    hostResults: [
      {
        id: "h1",
        category: "restaurant",
        businessName: "La Sandwicherie",
        distanceMiles: 0.5,
        hostNote: "Ask for the medianoche",
        websiteOrMapsLink: "https://example.com/sandwicherie",
        source: "host",
      },
      {
        id: "h2",
        category: "restaurant",
        businessName: "Puerto Sagua",
        distanceMiles: 1,
        hostNote: "",
        websiteOrMapsLink: "https://maps.google.com/?cid=host",
        source: "host",
      },
    ],
    results: [
      { name: "Cafe Luna", mapsUri: "https://maps.google.com/?cid=1" },
    ],
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("maps.googleapis.com") || url.includes("places.googleapis.com")) {
      googleHttpCalls += 1;
      throw new Error("Google must not be called when host results exist");
    }
    if (url.includes("/api/avatar")) {
      avatarCalls += 1;
      return new Response(JSON.stringify({ reply: "LLM should not run" }), { status: 200 });
    }
    if (url.includes("/api/places/nearby")) {
      placesCalls += 1;
      return new Response(JSON.stringify(hostGuidePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const hostAsk = await askAvatarReply({
    question: "Recommend a restaurant.",
    property,
    properties,
    language: "en",
    lastUserLang: "en",
  });
  assert(avatarCalls === 0, "host nearby intent called the LLM");
  assert(placesCalls === 1, "host nearby did not check places/local guide route");
  assert(googleHttpCalls === 0, "host result triggered a Google fetch");
  assert(hostAsk.source === "host", "host source missing");
  assertNoMix(hostAsk, "host ask");
  assert(!hostAsk.liveResults, "host result included Google liveResults");
  assert((hostAsk.hostResults?.length ?? 0) === 2, "hostResults count");
  assert(hostAsk.spokenText.includes("La Sandwicherie"), "host business names must be speakable");
  assert(hostAsk.spokenText.includes("Puerto Sagua"), "second host name missing from speech");
  assert(hostAsk.spokenText === "Your host recommends La Sandwicherie, half a mile away, and Puerto Sagua, one mile away.", "English host speech");
  assert(!/https?:\/\//i.test(hostAsk.spokenText), "host spokenText included a link");
  assert(!hostAsk.spokenText.toLowerCase().includes("example.com"), "host spokenText included website");
  assert(!hostAsk.spokenText.includes("Cafe Luna"), "mixed Google name into host speech");
  assertNoSecrets("host spoken", hostAsk.spokenText);
  assertNoSecrets("host display", hostAsk.displayText);
  const hostJson = JSON.stringify(hostAsk);
  assert(!hostJson.includes(property.wifiPassword), "host payload leaked wifi");
  assert(!hostJson.toLowerCase().includes("handbook"), "host payload leaked handbook");
  assert(!hostJson.includes(property.address), "host payload leaked address");

  const hostEs = await askAvatarReply({
    question: "Recomiendame un restaurante.",
    property,
    properties,
    language: "auto",
    lastUserLang: "es",
  });
  assert(hostEs.spokenText.includes("La Sandwicherie") && hostEs.spokenText.includes("Puerto Sagua"), "Spanish host names");
  assert(hostEs.spokenText.startsWith("Tu anfitrión recomienda"), "Spanish host prefix");
  assert(!/https?:\/\//i.test(hostEs.spokenText), "Spanish host speech included a URL");
  assert(googleHttpCalls === 0, "Spanish host path fetched Google");
  assert(avatarCalls === 0, "Spanish host path called avatar");

  placesCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/avatar")) {
      avatarCalls += 1;
      return new Response(JSON.stringify({ reply: "LLM should not run" }), { status: 200 });
    }
    if (url.includes("/api/places/nearby")) {
      placesCalls += 1;
      return new Response(
        JSON.stringify({
          source: "google",
          results: [
            { name: "Cafe Luna", mapsUri: "https://maps.google.com/?cid=1", distanceMiles: 0.2 },
            { name: "Harbor Grill", mapsUri: "https://maps.google.com/?cid=2" },
            { name: "Palm Kitchen", mapsUri: "https://maps.google.com/?cid=3" },
            { name: "Fourth Place", mapsUri: "https://maps.google.com/?cid=4" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const liveAsk = await askAvatarReply({
    question: "Recommend a restaurant.",
    property,
    properties,
    language: "en",
    lastUserLang: "en",
  });
  assert(avatarCalls === 0, "nearby intent called the LLM");
  assert(placesCalls === 1, "nearby intent did not call places route");
  assert(liveAsk.source === "google", "live Google source missing");
  assert(liveAsk.spokenText === GOOGLE_SPOKEN_EN, "live spokenText was not the fixed English line");
  assert(liveAsk.displayText === GOOGLE_SPOKEN_EN, "live displayText was not generic");
  assert((liveAsk.liveResults?.length ?? 0) === 3, "liveResults exceeded three");
  assert(liveAsk.liveResults?.some((row) => row.name === "Cafe Luna") === true, "liveResults missing business names");
  assert(liveAsk.liveResults?.some((row) => row.name === "Fourth Place") !== true, "liveResults included a fourth place");
  assert(liveAsk.liveResults?.every((row) => !("distanceMiles" in row)) === true, "liveResults included mileage");
  assertNoGoogleContentInSpeech("live spoken", liveAsk.spokenText, ["Cafe Luna", "Harbor Grill", "Palm Kitchen"]);
  assert(widgetAudioPath(liveAsk) === liveAsk.spokenText, "widget audio path did not use spokenText");
  assert(conciergeAudioPath(liveAsk) === liveAsk.spokenText, "concierge audio path did not use spokenText");
  assert(widgetAudioPath(liveAsk) !== liveAsk.liveResults?.[0]?.name, "audio path used a Google name");
  assertNoSecrets("askAvatar live restaurant spoken", liveAsk.spokenText);
  assertNoSecrets("askAvatar live restaurant display", liveAsk.displayText);
  assertNoMix(liveAsk, "google ask");
  assert(!liveAsk.hostResults, "google path included hostResults");

  const liveEs = await askAvatarReply({
    question: "Recomiendame un restaurante.",
    property,
    properties,
    language: "auto",
    lastUserLang: "es",
  });
  assert(liveEs.spokenText === GOOGLE_SPOKEN_ES, "Spanish spokenText was not the fixed line");
  assertNoGoogleContentInSpeech("live Spanish spoken", liveEs.spokenText, ["Cafe Luna"]);

  placesCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/avatar")) {
      avatarCalls += 1;
      return new Response(JSON.stringify({ reply: "LLM should not run" }), { status: 200 });
    }
    if (url.includes("/api/places/nearby")) {
      placesCalls += 1;
      return new Response(JSON.stringify({ error: "unavailable", code: "google" }), { status: 503 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const fallbackAsk = await askAvatarReply({
    question: "Where is a nearby pharmacy?",
    property,
    properties,
    language: "en",
    lastUserLang: "en",
  });
  globalThis.fetch = originalFetch;
  assert(avatarCalls === 0, "failed nearby intent called the LLM");
  assert(placesCalls === 1, "failed nearby intent skipped places route");
  assert(fallbackAsk.source === "fallback", "failure source was not fallback");
  assert(fallbackAsk.displayText === fallbackAsk.spokenText, "fallback display/spoken mismatch");
  assert(/live nearby-place lookup/i.test(fallbackAsk.spokenText), "failure did not use Open Maps fallback");
  assert(!fallbackAsk.liveResults, "fallback included liveResults");
  assert(!fallbackAsk.hostResults, "fallback included hostResults");
  assertNoMix(fallbackAsk, "fallback");
  assert(!/ocean pharmacy|cafe luna/i.test(fallbackAsk.spokenText), "fallback invented a business");
  assert(widgetAudioPath(fallbackAsk) === fallbackAsk.spokenText, "fallback widget audio was not spokenText");
  assertNoSecrets("askAvatar fallback pharmacy", fallbackAsk.spokenText);

  return {
    pharmacy,
    restaurant,
    wifi,
    door,
    checkout,
    hostAsk,
    hostEs,
    liveAsk,
    liveEs,
    fallbackAsk,
  };
}

const isDirectRun = process.argv[1]?.includes("guest-disclosure");
if (isDirectRun) {
  runGuestDisclosureTests()
    .then((samples) => {
      console.log("guest-disclosure tests passed");
      console.log(
        JSON.stringify(
          {
            pharmacy: samples.pharmacy,
            restaurant: samples.restaurant,
            wifi: samples.wifi,
            door: samples.door,
            checkout: samples.checkout,
            hostSpoken: samples.hostAsk.spokenText,
            hostNames: samples.hostAsk.hostResults?.map((row) => row.businessName),
            liveSpoken: samples.liveAsk.spokenText,
            liveNames: samples.liveAsk.liveResults?.map((row) => row.name),
            liveEsSpoken: samples.liveEs.spokenText,
            fallbackSpoken: samples.fallbackAsk.spokenText,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-disclosure tests failed");
      process.exitCode = 1;
    });
}
