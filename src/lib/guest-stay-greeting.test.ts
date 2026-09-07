import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_STAY_GREETING_EN,
  GUEST_STAY_GREETING_ES,
  GUEST_STAY_WELCOME_EN,
  GUEST_STAY_WELCOME_ES,
} from "./guest-stay-greeting";
import { GUEST_ELENA_TEXT_COPY, GUEST_STAY_WELCOME_COPY, guestStayWelcomeRequestBody } from "@/components/guest/guest-elena-text-card";
import { guestStayWelcomeText } from "./guest-stay-welcome";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runGuestStayGreetingTests() {
  assert(GUEST_STAY_GREETING_EN.includes("Isabela") && !GUEST_STAY_GREETING_EN.includes("Elena"), "English greeting brands Isabela");
  assert(GUEST_STAY_GREETING_ES.includes("Isabela") && !GUEST_STAY_GREETING_ES.includes("Elena"), "Spanish greeting brands Isabela");
  assert(GUEST_STAY_GREETING_EN === GUEST_STAY_WELCOME_EN, "visible English greeting is the English welcome TTS source");
  assert(GUEST_STAY_GREETING_ES === GUEST_STAY_WELCOME_ES, "visible Spanish greeting is the Spanish welcome TTS source");
  assert(GUEST_ELENA_TEXT_COPY.greetingEn === GUEST_STAY_WELCOME_EN, "Elena bubble English equals welcome TTS English");
  assert(GUEST_ELENA_TEXT_COPY.greetingEs === GUEST_STAY_WELCOME_ES, "Elena bubble Spanish equals welcome TTS Spanish");
  assert(GUEST_STAY_WELCOME_COPY.textEn === GUEST_STAY_GREETING_EN, "welcome copy English is the shared greeting");
  assert(GUEST_STAY_WELCOME_COPY.textEs === GUEST_STAY_GREETING_ES, "welcome copy Spanish is the shared greeting");
  assert(guestStayWelcomeText("en") === GUEST_STAY_GREETING_EN, "EN synthesizes only the English greeting");
  assert(guestStayWelcomeText("es") === GUEST_STAY_GREETING_ES, "ES synthesizes only the Spanish greeting");
  assert(guestStayWelcomeText("en") !== guestStayWelcomeText("es"), "EN and ES greetings stay distinct");
  assert(!guestStayWelcomeText("en").includes(GUEST_STAY_GREETING_ES), "EN does not include Spanish");
  assert(!guestStayWelcomeText("es").includes(GUEST_STAY_GREETING_EN), "ES does not include English");

  const body = guestStayWelcomeRequestBody("sample-token", "en");
  assert(Object.keys(body).sort().join(",") === "lang,token", "welcome request has no client-supplied speech text");

  const greetingSource = readFileSync(join(process.cwd(), "src/lib/guest-stay-greeting.ts"), "utf8");
  const welcomeSource = readFileSync(join(process.cwd(), "src/lib/guest-stay-welcome.ts"), "utf8");
  const cardSource = readFileSync(join(process.cwd(), "src/components/guest/guest-elena-text-card.tsx"), "utf8");
  const routeSource = readFileSync(join(process.cwd(), "src/app/api/guest/stay-welcome-tts/route.ts"), "utf8");
  assert(welcomeSource.includes('from "@/lib/guest-stay-greeting"'), "welcome TTS reads the shared greeting module");
  assert(cardSource.includes('from "@/lib/guest-stay-greeting"'), "Elena card reads the shared greeting module");
  assert(welcomeSource.includes("guestStayWelcomeText(parsed.lang)"), "server selects the spoken greeting from lang");
  assert(!welcomeSource.includes("parsed.text") && !welcomeSource.includes("body.text"), "welcome handler ignores client speech text");
  assert(!routeSource.includes("body.text") && !routeSource.includes("body.message"), "welcome route does not take client speech text");
  assert(!/wifiPassword|doorCode|gateCode|console\.(log|info|debug|error)/.test(greetingSource), "greeting module stays frozen and quiet");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-greeting.test");
if (isDirectRun) {
  try {
    runGuestStayGreetingTests();
    console.log("guest-stay-greeting tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-greeting tests failed");
    process.exitCode = 1;
  }
}
