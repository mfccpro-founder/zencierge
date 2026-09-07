import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectTtsUtteranceLang } from "./tts-synthesize";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runTtsSynthesizeTests() {
  assert(detectTtsUtteranceLang("Hello there, when is check-in?") === "en", "host auto-detect still returns English");
  assert(detectTtsUtteranceLang("Hola, gracias") === "es", "host auto-detect still returns Spanish");

  const source = readFileSync(join(process.cwd(), "src/lib/tts-synthesize.ts"), "utf8");
  assert(!source.includes("from \"@/lib/human-voice\""), "language detection is isolated from the host voice client");
  assert(source.includes("detectTtsUtteranceLang"), "auto language still uses local detection");
  assert(source.includes("synthesizeElenaSpeech"), "host synthesizeElenaSpeech remains");
  assert(source.includes("streamElenaSpeech"), "host streamElenaSpeech remains");
  const guestFn = source.slice(source.indexOf("export async function synthesizeGuestElenaMp3"));
  const guestInstructions = source.slice(
    source.indexOf("function guestElenaOpenAiInstructions"),
    source.indexOf("export async function synthesizeGuestElenaMp3"),
  );
  assert(guestFn.includes("response_format: \"mp3\"") || guestFn.includes("output_format=mp3"), "guest adapter returns MP3");
  assert(guestFn.includes('voice: "coral"'), "guest OpenAI synthesis uses coral");
  assert(!guestFn.includes('voice: "marin"'), "guest OpenAI synthesis no longer uses marin");
  assert(guestFn.includes("OPENAI_STREAM_TTS_MODEL") || guestFn.includes("gpt-4o-mini-tts"), "guest OpenAI keeps gpt-4o-mini-tts");
  assert(guestFn.includes("speed: 1"), "guest OpenAI speed is unchanged");
  assert(guestFn.includes("language_code: input.language"), "guest ElevenLabs language remains en/es from the stay reply");
  assert(guestFn.includes("guestElenaOpenAiInstructions(input.language)"), "guest OpenAI instructions stay language-specific");
  assert(guestInstructions.includes("Do not switch to Spanish."), "English instructions keep English-only delivery");
  assert(guestInstructions.includes("Do not switch to English."), "Spanish instructions keep Spanish-only delivery");
  assert(guestInstructions.includes("warm, clear, smooth adult female hospitality concierge"), "instructions keep a warm clear female concierge");
  assert(guestInstructions.includes("slightly brighter, medium-pitched"), "instructions keep a slightly brighter medium pitch");
  assert(guestInstructions.includes("Avoid hoarse, raspy, gravelly, breathy, or unusually deep delivery."), "instructions reject raspy delivery");
  assert(guestInstructions.includes("Speak only the supplied reply."), "instructions do not add words");
  assert(guestInstructions.includes("Speak the supplied text naturally and verbatim."), "instructions require natural verbatim speech");
  assert(guestInstructions.includes("calm, warm, clear hospitality voice"), "instructions keep a calm hospitality voice");
  assert(guestInstructions.includes("consistent moderate volume"), "instructions keep moderate volume");
  assert(guestInstructions.includes("Do not shout or scream."), "instructions forbid shouting");
  assert(guestInstructions.includes("Do not sing, whisper, laugh, or add sound effects, dramatic noises, or extra words."), "instructions forbid non-speech delivery");
  assert(guestInstructions.includes("An English reply remains English."), "English replies stay English");
  assert(guestInstructions.includes("A Spanish reply remains Spanish."), "Spanish replies stay Spanish");
  assert(!guestFn.includes("input.voice") && !guestFn.includes("input.provider"), "no client-selected voice or provider");
  assert(!guestFn.includes("for (const model"), "guest adapter does not loop paid models");
}

const isDirectRun = process.argv[1]?.includes("tts-synthesize.test");
if (isDirectRun) {
  try {
    runTtsSynthesizeTests();
    console.log("tts-synthesize tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "tts-synthesize tests failed");
    process.exitCode = 1;
  }
}
