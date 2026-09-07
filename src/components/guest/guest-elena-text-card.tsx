"use client";

import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import { Mic } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { publicApiUrl } from "@/lib/public-app-url";
import {
  createGuestStayAudioEngine,
  guestStayAudioBlobFromResponse,
  guestStayAudioPostInit,
  GUEST_STAY_AUDIO_PATH,
  GUEST_STAY_WELCOME_TTS_PATH,
  shouldFetchGuestStayAudio,
  type GuestStayAudioElement,
  type GuestStayObjectUrlApi,
} from "@/lib/guest-stay-audio";
import { GUEST_STAY_GREETING_EN, GUEST_STAY_GREETING_ES } from "@/lib/guest-stay-greeting";
import {
  createGuestStayListenEngine,
  evaluateGuestStayListenSupport,
  getGuestStaySpeechRecognitionCtor,
  GUEST_STAY_LISTEN_COPY,
  guestStayFinalListenSendText,
  guestStayListenCanStart,
  type GuestStayListenLang,
  type GuestStayListenStatus,
} from "@/lib/guest-stay-listen";
import {
  createBrowserGuestStaySpeechSynth,
  createGuestStaySpeechEngine,
  parseGuestStaySpeechLang,
  shouldSpeakGuestStayText,
  type GuestStaySpeechStatus,
} from "@/lib/guest-stay-speech";
import {
  GUEST_STAY_MOBILE_STT_COPY,
  GuestStayMobileSttStartupError,
  classifyGuestStayMobileMicError,
  guestStayIsMobileBrowser,
  guestStayMobileServerSttPreferred,
  guestStayMobileSttDevDiag,
  guestStayMobileSttUiMode,
  postGuestStayMobileTranscribe,
  startGuestStayMobileSttSession,
  type GuestStayMobileSttFailKind,
  type GuestStayMobileSttSession,
} from "@/lib/guest-stay-mobile-stt";

export const GUEST_STAY_CHAT_VISIBLE_LIMIT = 8;
export const GUEST_STAY_GREETING_BUBBLE_ID = "elena-hello";

export const GUEST_ELENA_TEXT_COPY = {
  titleEn: "Isabela · Receptionist",
  titleEs: "Isabela · Recepcionista",
  subtitleEn: "Text concierge",
  subtitleEs: "Conserjería por texto",
  privacyEn: "Do not enter passwords, access codes, or payment information.",
  privacyEs: "No escribas contraseñas, códigos de acceso ni datos de pago.",
  sendEn: "Send",
  sendEs: "Enviar",
  sendingEn: "Sending…",
  sendingEs: "Enviando…",
  errorEn: "Message could not be sent. Try again.",
  errorEs: "No se pudo enviar el mensaje. Inténtalo de nuevo.",
  retryEn: "Retry",
  retryEs: "Reintentar",
  greetingEn: GUEST_STAY_GREETING_EN,
  greetingEs: GUEST_STAY_GREETING_ES,
  listenEn: "Listen",
  listenEs: "Escuchar",
  stopEn: "Stop voice",
  stopEs: "Detener voz",
  speakingEn: "Speaking",
  speakingEs: "Hablando",
  stoppedEn: "Stopped",
  stoppedEs: "Detenida",
  voiceUnavailableEn: "Voice unavailable",
  voiceUnavailableEs: "Voz no disponible",
  preparingVoiceEn: "Preparing Isabela voice…",
  preparingVoiceEs: "Preparando la voz de Isabela…",
  placeholderEn: "Type a message",
  placeholderEs: "Escribe un mensaje",
  clearEn: "Clear chat",
  clearEs: "Borrar chat",
} as const;

/** Simplified mobile Guest Stay — type / native keyboard dictation (no custom mic). */
export const GUEST_STAY_SIMPLE_MOBILE_COPY = {
  placeholderEn: "Ask Isabela anything…",
  placeholderEs: "Pregúntale a Isabela…",
  replyLangEn: "Reply language",
  replyLangEs: "Idioma de respuesta",
  dictateHelperEn:
    "🎤 Want to speak instead of type? Tap the message box, use your phone keyboard microphone, speak, then tap Send. For best results, use the same language on your phone keyboard.",
  dictateHelperEs:
    "🎤 ¿Prefieres hablar en vez de escribir? Toca el cuadro de mensaje, usa el micrófono del teclado de tu teléfono, habla y toca Enviar. Para mejores resultados, usa el mismo idioma en el teclado de tu teléfono.",
  dictateCollapsedEn: "🎤 Use your phone keyboard microphone to dictate.",
  dictateCollapsedEs: "🎤 Usa el micrófono del teclado de tu teléfono para dictar.",
  dictateMicHintEn: "Use the microphone on your phone keyboard to speak.",
  dictateMicHintEs: "Usa el micrófono del teclado de tu teléfono para hablar.",
  dictateMicAriaEn: "Keyboard dictation tip",
  dictateMicAriaEs: "Consejo de dictado del teclado",
  listenEn: "🔊 Listen",
  listenEs: "🔊 Escuchar",
  checkInEn: "Check-in",
  checkInEs: "Entrada",
  checkOutEn: "Check-out",
  checkOutEs: "Salida",
  accessEn: "Access",
  accessEs: "Acceso",
  wifiEn: "Wi-Fi",
  wifiEs: "Wi-Fi",
  nearbyEn: "Nearby",
  nearbyEs: "Cerca",
  thingsEn: "Things to do",
  thingsEs: "Qué hacer",
  reportEn: "Report a problem",
  reportEs: "Reportar un problema",
} as const;

export type GuestStaySimpleMobileQuickActionId =
  | "check-in"
  | "checkout"
  | "access"
  | "wifi"
  | "nearby"
  | "things"
  | "report";

export function guestStaySimpleMobileUiPreferred(input?: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}) {
  return guestStayIsMobileBrowser(input);
}

/** After the first successful guest send, collapse the full dictation how-to. */
export function guestStaySimpleMobileDictateCollapsed(hasSentSuccessfully: boolean) {
  return hasSentSuccessfully;
}

/** Focus the secure Access section — never reveals credentials through chat. */
export function focusGuestStayAccessSection() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("guest-stay-access");
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    /* ignore */
  }
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

export function guestStaySimpleMobileQuickActionLabel(
  id: GuestStaySimpleMobileQuickActionId,
  lang: GuestStayListenLang,
) {
  const es = lang === "es";
  switch (id) {
    case "check-in":
      return es ? GUEST_STAY_SIMPLE_MOBILE_COPY.checkInEs : GUEST_STAY_SIMPLE_MOBILE_COPY.checkInEn;
    case "checkout":
      return es ? GUEST_STAY_SIMPLE_MOBILE_COPY.checkOutEs : GUEST_STAY_SIMPLE_MOBILE_COPY.checkOutEn;
    case "access":
      return es ? GUEST_STAY_SIMPLE_MOBILE_COPY.accessEs : GUEST_STAY_SIMPLE_MOBILE_COPY.accessEn;
    case "wifi":
      return es ? GUEST_STAY_SIMPLE_MOBILE_COPY.wifiEs : GUEST_STAY_SIMPLE_MOBILE_COPY.wifiEn;
    case "nearby":
      return es ? GUEST_STAY_SIMPLE_MOBILE_COPY.nearbyEs : GUEST_STAY_SIMPLE_MOBILE_COPY.nearbyEn;
    case "things":
      return es ? GUEST_STAY_SIMPLE_MOBILE_COPY.thingsEs : GUEST_STAY_SIMPLE_MOBILE_COPY.thingsEn;
    case "report":
      return es ? GUEST_STAY_SIMPLE_MOBILE_COPY.reportEs : GUEST_STAY_SIMPLE_MOBILE_COPY.reportEn;
  }
}

/** Chat prompts that hit existing intents — no new backend data. */
export function guestStaySimpleMobileQuickActionMessage(
  id: Exclude<GuestStaySimpleMobileQuickActionId, "access">,
  lang: GuestStayListenLang,
) {
  const es = lang === "es";
  switch (id) {
    case "check-in":
      return es ? "¿A qué hora es la entrada?" : "What time is check-in?";
    case "checkout":
      return es ? "¿A qué hora es la salida?" : "What time is check-out?";
    case "wifi":
      return es ? "¿Cuál es la clave wifi?" : "What is the wifi password?";
    case "nearby":
      return es ? "guía local cerca" : "local guide nearby";
    case "things":
      return es ? "tours y atracciones" : "things to do tours";
    case "report":
      return es ? "necesito reportar un problema" : "I need to report a problem";
  }
}

export const GUEST_STAY_SIMPLE_MOBILE_QUICK_ACTIONS: readonly GuestStaySimpleMobileQuickActionId[] = [
  "check-in",
  "checkout",
  "access",
  "wifi",
  "nearby",
  "things",
  "report",
] as const;

export type GuestStayChatBubble = {
  id: string;
  role: "elena" | "guest";
  text: string;
};

export function visibleGuestStayChatMessages<T>(messages: readonly T[]): T[] {
  return messages.slice(-GUEST_STAY_CHAT_VISIBLE_LIMIT);
}

export type GuestStayChatSendOutcome = "success" | "failure" | "abort";

export type GuestStayChatLifecycleSnapshot = {
  mounted: boolean;
  generation: number;
  sending: boolean;
  error: boolean;
  retryMessage: string | null;
  messages: GuestStayChatBubble[];
  input: string;
  stateWrites: number;
  listening: boolean;
  listenGeneration: number;
  speechCancelled: number;
  ttsAborted: number;
  serverVoiceLoading: boolean;
  browserSpeechStarts: number;
  manualListenBlocked: number;
  welcomeLoading: boolean;
  welcomeSpeaking: boolean;
  welcomeRequests: number;
  welcomeFallbackStarts: number;
  replyVoiceGeneration: number;
  welcomeGeneration: number;
  staleReplyCompletions: number;
  staleWelcomeCompletions: number;
  bothVoicesStopped: number;
};

export function initialGuestStayChatTranscript(options?: {
  includeGreeting?: boolean;
}): GuestStayChatBubble[] {
  if (options?.includeGreeting === false) return [];
  return [
    {
      id: GUEST_STAY_GREETING_BUBBLE_ID,
      role: "elena",
      text: `${GUEST_ELENA_TEXT_COPY.greetingEn}\n\n${GUEST_ELENA_TEXT_COPY.greetingEs}`,
    },
  ];
}

/** Mobile simplified UI hides the seeded bilingual intro bubble only — not live replies. */
export function guestStayChatMessagesForDisplay(
  messages: readonly GuestStayChatBubble[],
  options?: { hideSeededGreeting?: boolean },
): GuestStayChatBubble[] {
  const visible = visibleGuestStayChatMessages(messages);
  if (!options?.hideSeededGreeting) return visible;
  return visible.filter((bubble) => bubble.id !== GUEST_STAY_GREETING_BUBBLE_ID);
}

export function guestStayHasSpeakableAssistantReply(messages: readonly GuestStayChatBubble[]): boolean {
  return messages.some((bubble) => bubble.role === "elena" && bubble.id !== GUEST_STAY_GREETING_BUBBLE_ID);
}

export function guestStayVoiceControlMode(input: {
  messages: readonly GuestStayChatBubble[];
  speechStatus: GuestStaySpeechStatus;
  serverVoiceLoading?: boolean;
}): "hidden" | "preparing" | "listen" | "stop" {
  if (!guestStayHasSpeakableAssistantReply(input.messages)) return "hidden";
  if (input.serverVoiceLoading) return "preparing";
  return input.speechStatus === "speaking" ? "stop" : "listen";
}

export function guestStayManualListenAllowed(serverVoiceLoading: boolean) {
  return !serverVoiceLoading;
}

export function guestStayFinishServerVoiceLoading(input: {
  mounted: boolean;
  ownerGeneration: number;
  currentGeneration: number;
  superseded: boolean;
}) {
  if (input.superseded) return false;
  return input.mounted && input.ownerGeneration === input.currentGeneration;
}

export function guestStayIsCurrentReplyVoice(input: {
  mounted: boolean;
  chatOwner: number;
  chatCurrent: number;
  replyOwner: number;
  replyCurrent: number;
}) {
  return (
    input.mounted &&
    input.chatOwner === input.chatCurrent &&
    input.replyOwner === input.replyCurrent
  );
}

export function guestStayFinishReplyVoiceLoading(input: {
  mounted: boolean;
  chatOwner: number;
  chatCurrent: number;
  replyOwner: number;
  replyCurrent: number;
  superseded: boolean;
}) {
  if (input.superseded) return false;
  return guestStayIsCurrentReplyVoice(input);
}

export function guestStayShouldStartBrowserFallback(input: {
  finishLoading: boolean;
  wasLoading: boolean;
  outcome: "playing" | "retained" | "failed" | "stale" | "aborted";
}) {
  return input.wasLoading && input.finishLoading && input.outcome === "failed";
}

export function guestStayChatClearedUi(options?: { includeGreeting?: boolean }) {
  return {
    messages: initialGuestStayChatTranscript(options),
    input: "",
    sending: false,
    error: false,
    retryMessage: null as string | null,
    speechStatus: "idle" as GuestStaySpeechStatus,
    listenStatus: "idle" as GuestStayListenStatus,
    serverVoiceLoading: false,
  };
}

export function swallowGuestStayChatCleanup(run: () => void) {
  try {
    run();
  } catch {
    return;
  }
}

export function appendGuestStayChatMessageIfCurrent(input: {
  current: GuestStayChatBubble[];
  next: GuestStayChatBubble;
  isCurrent: boolean;
}): GuestStayChatBubble[] {
  if (!input.isCurrent) return input.current;
  return visibleGuestStayChatMessages([...input.current, input.next]);
}

export const GUEST_STAY_WELCOME_COPY = {
  hearEn: "Hear welcome",
  hearEs: "Escuchar bienvenida",
  preparingEn: "Preparing welcome…",
  preparingEs: "Preparando bienvenida…",
  stopEn: "Stop welcome",
  stopEs: "Detener bienvenida",
  textEn: GUEST_STAY_GREETING_EN,
  textEs: GUEST_STAY_GREETING_ES,
} as const;

export function guestStayWelcomeRequestBody(token: string, lang: "en" | "es") {
  return { token, lang };
}

export function guestStayWelcomeControlMode(input: { loading: boolean; speaking: boolean }): "hear" | "preparing" | "stop" {
  if (input.loading) return "preparing";
  if (input.speaking) return "stop";
  return "hear";
}

export function guestStayTapBlockedByWelcome(input: { welcomeLoading: boolean; welcomeSpeaking: boolean }) {
  return input.welcomeLoading || input.welcomeSpeaking;
}

/** Short pause after reply audio so the device speaker is less likely to re-enter the mic. */
export const GUEST_STAY_POST_SPEECH_REARM_MS = 400;

/**
 * Extra settle after Spanish reply TTS before auto-rearm.
 * iPhone WebKit often returns empty `no-speech` if SpeechRecognition starts too soon after TTS.
 * English keeps {@link GUEST_STAY_POST_SPEECH_REARM_MS} only.
 */
export const GUEST_STAY_SPANISH_POST_TTS_SETTLE_MS = 1_000;

/** Rearm delay after reply speech ends; Spanish gets a longer post-TTS audio-session settle. */
export function guestStayPostSpeechRearmDelayMs(lang: GuestStayListenLang) {
  return lang === "es" ? GUEST_STAY_SPANISH_POST_TTS_SETTLE_MS : GUEST_STAY_POST_SPEECH_REARM_MS;
}

/** iPhone / iPad / iPod — including common WebKit UA spellings. */
export function guestStayIsIosUserAgent(userAgent: string) {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

/**
 * Whether post-TTS SpeechRecognition auto-rearm is allowed.
 * Mobile (iOS/Android/iPadOS) skips auto-rearm: each voice turn needs a fresh tap.
 * Desktop / non-mobile keep Web Speech auto-rearm.
 */
export function guestStayPostSpeechListenRearmEnabled(input?: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}) {
  if (guestStayIsMobileBrowser(input)) return false;
  return true;
}

/** Claim once-per-reply-owner before scheduling an auto listen restart. */
export function guestStayShouldScheduleListenRearm(input: {
  mounted: boolean;
  chatOwner: number;
  chatCurrent: number;
  replyOwner: number;
  replyCurrent: number;
  alreadyClaimedReplyOwner: number | null;
  /** When false (iOS), never schedule post-TTS auto-rearm. Defaults to true. */
  allowAutoRearm?: boolean;
}) {
  if (input.allowAutoRearm === false) return false;
  if (
    !guestStayIsCurrentReplyVoice({
      mounted: input.mounted,
      chatOwner: input.chatOwner,
      chatCurrent: input.chatCurrent,
      replyOwner: input.replyOwner,
      replyCurrent: input.replyCurrent,
    })
  ) {
    return false;
  }
  if (input.alreadyClaimedReplyOwner === input.replyOwner) return false;
  return true;
}

/** Final gate immediately before calling startListening after reply TTS/fallback ends. */
export function guestStayShouldStartListenRearm(input: {
  mounted: boolean;
  chatOwner: number;
  chatCurrent: number;
  replyOwner: number;
  replyCurrent: number;
  welcomeLoading: boolean;
  welcomeSpeaking: boolean;
  sending: boolean;
  alreadyListening: boolean;
  speechSpeaking: boolean;
  listenCanStart: boolean;
}) {
  if (
    !guestStayIsCurrentReplyVoice({
      mounted: input.mounted,
      chatOwner: input.chatOwner,
      chatCurrent: input.chatCurrent,
      replyOwner: input.replyOwner,
      replyCurrent: input.replyCurrent,
    })
  ) {
    return false;
  }
  if (guestStayTapBlockedByWelcome({ welcomeLoading: input.welcomeLoading, welcomeSpeaking: input.welcomeSpeaking })) {
    return false;
  }
  if (input.sending) return false;
  if (input.alreadyListening) return false;
  if (input.speechSpeaking) return false;
  if (!input.listenCanStart) return false;
  return true;
}

export function guestStayChatRequestBody(
  token: string,
  message: string,
  preferredLang?: "en" | "es",
) {
  if (preferredLang === "en" || preferredLang === "es") {
    return { token, message, preferredLang };
  }
  return { token, message };
}

export function canStartGuestStayChatSend(input: { sending: boolean; message: string }) {
  const trimmed = input.message.trim();
  return !input.sending && trimmed.length >= 1 && trimmed.length <= 500;
}

export function restoreGuestStayChatInput(input: {
  mounted: boolean;
  isCurrentGeneration: boolean;
  currentInput: string;
  originalMessage: string;
}) {
  if (!input.mounted || !input.isCurrentGeneration) return input.currentInput;
  if (input.currentInput.trim() !== "") return input.currentInput;
  return input.originalMessage;
}

export function createGuestStayChatLifecycle() {
  let mounted = true;
  let generation = 0;
  let sending = false;
  let error = false;
  let retryMessage: string | null = null;
  let input = "";
  let seq = 0;
  let lastMessage = "";
  let messages = initialGuestStayChatTranscript();
  let stateWrites = 0;
  let inFlightGeneration: number | null = null;
  let listening = false;
  let listenGeneration = 0;
  let speechCancelled = 0;
  let ttsAborted = 0;
  let serverVoiceLoading = false;
  let ttsControllerId = 0;
  let activeTtsControllerId = 0;
  let browserSpeechStarts = 0;
  let manualListenBlocked = 0;
  let welcomeLoading = false;
  let welcomeSpeaking = false;
  let welcomeRequests = 0;
  let welcomeFallbackStarts = 0;
  let replyVoiceGeneration = 0;
  let welcomeGeneration = 0;
  let lastReplyVoiceOwner = 0;
  let lastWelcomeOwner = 0;
  let staleReplyCompletions = 0;
  let staleWelcomeCompletions = 0;
  let bothVoicesStopped = 0;

  function snapshot(): GuestStayChatLifecycleSnapshot {
    return {
      mounted,
      generation,
      sending,
      error,
      retryMessage,
      messages: [...messages],
      input,
      stateWrites,
      listening,
      listenGeneration,
      speechCancelled,
      ttsAborted,
      serverVoiceLoading,
      browserSpeechStarts,
      manualListenBlocked,
      welcomeLoading,
      welcomeSpeaking,
      welcomeRequests,
      welcomeFallbackStarts,
      replyVoiceGeneration,
      welcomeGeneration,
      staleReplyCompletions,
      staleWelcomeCompletions,
      bothVoicesStopped,
    };
  }

  function writeState(update: () => void) {
    if (!mounted) return false;
    update();
    stateWrites += 1;
    return true;
  }

  function releaseInFlight(gen: number) {
    if (inFlightGeneration === gen) {
      inFlightGeneration = null;
      sending = false;
    }
  }

  function abortListen() {
    listenGeneration += 1;
    listening = false;
  }

  function cancelSpeech() {
    speechCancelled += 1;
  }

  function abortTts() {
    ttsAborted += 1;
  }

  function haltChatVoice() {
    replyVoiceGeneration += 1;
    abortTts();
    cancelSpeech();
    serverVoiceLoading = false;
  }

  function haltWelcomeVoice() {
    welcomeGeneration += 1;
    welcomeLoading = false;
    welcomeSpeaking = false;
  }

  const api = {
    snapshot,
    beginSend(raw: string) {
      const message = raw.trim();
      if (!mounted) return null;
      if (sending || inFlightGeneration !== null) return null;
      if (!canStartGuestStayChatSend({ sending: false, message })) return null;
      abortListen();
      haltChatVoice();
      haltWelcomeVoice();
      generation += 1;
      inFlightGeneration = generation;
      sending = true;
      lastMessage = message;
      writeState(() => {
        error = false;
        retryMessage = null;
        input = "";
        seq += 1;
        messages = visibleGuestStayChatMessages([
          ...messages,
          { id: `guest-${seq}`, role: "guest", text: message },
        ]);
      });
      return { generation, message };
    },
    typeInput(value: string) {
      if (!mounted) return snapshot();
      writeState(() => {
        input = value;
      });
      return snapshot();
    },
    startListen() {
      if (!mounted) return null;
      if (guestStayTapBlockedByWelcome({ welcomeLoading, welcomeSpeaking })) return null;
      abortListen();
      haltChatVoice();
      haltWelcomeVoice();
      listenGeneration += 1;
      listening = true;
      return listenGeneration;
    },
    finishListen(gen: number, recognized: string) {
      if (!mounted || gen !== listenGeneration || !listening) return snapshot();
      writeState(() => {
        listening = false;
      });
      const message = guestStayFinalListenSendText(input, recognized);
      if (!message) return snapshot();
      if (sending || inFlightGeneration !== null) {
        writeState(() => {
          input = message;
        });
        return snapshot();
      }
      api.beginSend(message);
      return snapshot();
    },
    stopListen() {
      abortListen();
      return snapshot();
    },
    clearChat() {
      if (!mounted) return snapshot();
      generation += 1;
      abortListen();
      haltChatVoice();
      haltWelcomeVoice();
      inFlightGeneration = null;
      sending = false;
      const ui = guestStayChatClearedUi();
      writeState(() => {
        error = ui.error;
        retryMessage = ui.retryMessage;
        input = ui.input;
        seq = 0;
        messages = ui.messages;
        listening = false;
      });
      swallowGuestStayChatCleanup(() => {
        cancelSpeech();
      });
      return snapshot();
    },
    finish(gen: number, outcome: GuestStayChatSendOutcome, reply = "") {
      const isCurrentFlight = inFlightGeneration === gen;
      releaseInFlight(gen);
      if (!mounted) return snapshot();
      if (!isCurrentFlight || gen !== generation) return snapshot();
      writeState(() => {
        if (gen !== generation) return;
        sending = false;
        if (outcome === "success") {
          error = false;
          retryMessage = null;
          const text = reply.trim();
          if (text) {
            seq += 1;
            messages = appendGuestStayChatMessageIfCurrent({
              current: messages,
              next: { id: `elena-${seq}`, role: "elena", text },
              isCurrent: gen === generation,
            });
          }
        } else if (outcome === "failure") {
          error = true;
          retryMessage = lastMessage;
          input = restoreGuestStayChatInput({
            mounted: true,
            isCurrentGeneration: gen === generation,
            currentInput: input,
            originalMessage: lastMessage,
          });
        } else {
          error = false;
        }
      });
      return snapshot();
    },
    unmount() {
      mounted = false;
      generation += 1;
      abortListen();
      haltChatVoice();
      haltWelcomeVoice();
      inFlightGeneration = null;
      sending = false;
      return snapshot();
    },
    remount() {
      mounted = true;
      generation += 1;
      abortListen();
      haltChatVoice();
      haltWelcomeVoice();
      inFlightGeneration = null;
      sending = false;
      error = false;
      retryMessage = null;
      input = "";
      seq = 0;
      messages = initialGuestStayChatTranscript();
      return snapshot();
    },
    beginStayAudio(ownerGeneration: number) {
      haltWelcomeVoice();
      replyVoiceGeneration += 1;
      lastReplyVoiceOwner = replyVoiceGeneration;
      abortTts();
      ttsControllerId += 1;
      activeTtsControllerId = ttsControllerId;
      if (
        !guestStayIsCurrentReplyVoice({
          mounted,
          chatOwner: ownerGeneration,
          chatCurrent: generation,
          replyOwner: lastReplyVoiceOwner,
          replyCurrent: replyVoiceGeneration,
        })
      ) {
        return snapshot();
      }
      writeState(() => {
        serverVoiceLoading = true;
      });
      return snapshot();
    },
    finishStayAudio(
      ownerGeneration: number,
      outcome: "playing" | "retained" | "failed" | "stale" | "aborted",
      controllerId = activeTtsControllerId,
      replyOwner = lastReplyVoiceOwner,
    ) {
      const wasLoading = serverVoiceLoading;
      const finishLoading = guestStayFinishReplyVoiceLoading({
        mounted,
        chatOwner: ownerGeneration,
        chatCurrent: generation,
        replyOwner,
        replyCurrent: replyVoiceGeneration,
        superseded: controllerId !== activeTtsControllerId,
      });
      if (!finishLoading) {
        staleReplyCompletions += 1;
        return snapshot();
      }
      writeState(() => {
        serverVoiceLoading = false;
      });
      if (guestStayShouldStartBrowserFallback({ finishLoading, wasLoading, outcome })) {
        browserSpeechStarts += 1;
        cancelSpeech();
      }
      if (outcome === "playing") cancelSpeech();
      return snapshot();
    },
    attemptManualListen() {
      haltWelcomeVoice();
      if (!guestStayManualListenAllowed(serverVoiceLoading)) {
        manualListenBlocked += 1;
        return snapshot();
      }
      return snapshot();
    },
    stopVoice() {
      haltWelcomeVoice();
      haltChatVoice();
      bothVoicesStopped += 1;
      return snapshot();
    },
    beginWelcome() {
      if (!mounted) return snapshot();
      abortListen();
      haltChatVoice();
      welcomeGeneration += 1;
      lastWelcomeOwner = welcomeGeneration;
      welcomeRequests += 1;
      writeState(() => {
        welcomeLoading = true;
        welcomeSpeaking = false;
      });
      return snapshot();
    },
    finishWelcome(outcome: "playing" | "retained" | "failed" | "stale", welcomeOwner = lastWelcomeOwner) {
      if (!mounted || welcomeOwner !== welcomeGeneration) {
        staleWelcomeCompletions += 1;
        return snapshot();
      }
      const wasLoading = welcomeLoading;
      writeState(() => {
        welcomeLoading = false;
        welcomeSpeaking = outcome === "playing";
      });
      if (wasLoading && outcome === "failed") {
        welcomeFallbackStarts += 1;
        cancelSpeech();
      }
      return snapshot();
    },
    stopWelcome() {
      if (!mounted) return snapshot();
      haltWelcomeVoice();
      return snapshot();
    },
    changeLang() {
      if (!mounted) return snapshot();
      haltWelcomeVoice();
      cancelSpeech();
      return snapshot();
    },
  };
  return api;
}

export function GuestElenaTextCard({ token }: { token: string }) {
  return <GuestElenaTextCardSession key={token} token={token} />;
}

function subscribeGuestStayListenSupport() {
  return () => {};
}

function readGuestStayListenSupport(): ReturnType<typeof evaluateGuestStayListenSupport> {
  if (typeof window === "undefined") return "unavailable";
  return evaluateGuestStayListenSupport({
    isBrowser: true,
    isSecureContext: window.isSecureContext,
    hasCtor: Boolean(getGuestStaySpeechRecognitionCtor()),
  });
}

function guestStayBrowserObjectUrls(): GuestStayObjectUrlApi {
  return {
    create(blob) {
      return URL.createObjectURL(blob);
    },
    revoke(url) {
      URL.revokeObjectURL(url);
    },
  };
}

function guestStayBrowserAudioElement(): GuestStayAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const el = new Audio();
  let ended: (() => void) | null = null;
  let errored: (() => void) | null = null;
  return {
    get src() {
      return el.src;
    },
    set src(value) {
      el.src = value;
    },
    get currentTime() {
      return el.currentTime;
    },
    set currentTime(value) {
      el.currentTime = value;
    },
    get duration() {
      return el.duration;
    },
    get volume() {
      return el.volume;
    },
    set volume(value) {
      el.volume = value;
    },
    pause() {
      el.pause();
    },
    play() {
      return el.play().then(() => undefined);
    },
    addEventListener(type, listener) {
      el.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      el.removeEventListener(type, listener);
    },
    get onended() {
      return ended;
    },
    set onended(handler) {
      ended = handler;
      el.onended = handler ? () => handler() : null;
    },
    get onerror() {
      return errored;
    },
    set onerror(handler) {
      errored = handler;
      el.onerror = handler ? () => handler() : null;
    },
  };
}

function GuestElenaTextCardSession({ token }: { token: string }) {
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const replyVoiceGenerationRef = useRef(0);
  const inFlightRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const speechEngineRef = useRef(createGuestStaySpeechEngine());
  const speechSynthRef = useRef(createBrowserGuestStaySpeechSynth());
  const listenEngineRef = useRef(createGuestStayListenEngine());
  const audioEngineRef = useRef(createGuestStayAudioEngine());
  const audioElRef = useRef<GuestStayAudioElement | null>(null);
  const audioUrlsRef = useRef<GuestStayObjectUrlApi>(guestStayBrowserObjectUrls());
  const welcomeEngineRef = useRef(createGuestStayAudioEngine());
  const welcomeElRef = useRef<GuestStayAudioElement | null>(null);
  const welcomeUrlsRef = useRef<GuestStayObjectUrlApi>(guestStayBrowserObjectUrls());
  const welcomeAbortRef = useRef<AbortController | null>(null);
  const welcomeGenRef = useRef(0);
  const welcomeFallbackGenRef = useRef<number | null>(null);
  const welcomeLoadingRef = useRef(false);
  const welcomeSpeakingRef = useRef(false);
  const speechFallbackGenRef = useRef<number | null>(null);
  const listenRearmClaimedReplyRef = useRef<number | null>(null);
  const listenRearmTimerRef = useRef<number | null>(null);
  const pendingReplySpeechRearmRef = useRef<{ chatOwner: number; replyOwner: number } | null>(null);
  const lastAssistantRef = useRef<{ text: string; lang: "en" | "es" } | null>(null);
  const serverVoiceLoadingRef = useRef(false);
  const mobileSessionRef = useRef<GuestStayMobileSttSession | null>(null);
  const mobileAbortRef = useRef<AbortController | null>(null);
  const mobileRecordingRef = useRef(false);
  const mobileProcessingRef = useRef(false);
  const mobileStartingRef = useRef(false);
  const [input, setInput] = useState("");
  const inputRef = useRef("");
  const sendRef = useRef<(raw: string) => Promise<void>>(async () => {});
  const startListeningRef = useRef<(lang?: GuestStayListenLang) => void>(() => {});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<GuestStayChatBubble[]>(initialGuestStayChatTranscript);
  const [speechStatus, setSpeechStatus] = useState<GuestStaySpeechStatus>("idle");
  const [serverVoiceLoading, setServerVoiceLoading] = useState(false);
  const [listenLang, setListenLang] = useState<GuestStayListenLang>("en");
  const listenLangRef = useRef<GuestStayListenLang>("en");
  const [welcomeLoading, setWelcomeLoading] = useState(false);
  const [welcomeSpeaking, setWelcomeSpeaking] = useState(false);
  const [listenStatus, setListenStatus] = useState<GuestStayListenStatus>("idle");
  const [mobileRecording, setMobileRecording] = useState(false);
  const [mobileProcessing, setMobileProcessing] = useState(false);
  const [mobileStarting, setMobileStarting] = useState(false);
  const [mobileSttFail, setMobileSttFail] = useState<GuestStayMobileSttFailKind | null>(null);
  const [mobileDictateCollapsed, setMobileDictateCollapsed] = useState(false);
  const [mobileMicHintVisible, setMobileMicHintVisible] = useState(false);
  const messageInputElRef = useRef<HTMLInputElement | null>(null);
  const mobileMicHintTimerRef = useRef<number | null>(null);
  const listenSupport = useSyncExternalStore(
    subscribeGuestStayListenSupport,
    readGuestStayListenSupport,
    (): ReturnType<typeof evaluateGuestStayListenSupport> => "unavailable",
  );
  const mobileServerStt = useSyncExternalStore(
    () => () => {},
    () => guestStayMobileServerSttPreferred(),
    () => false,
  );
  /** Production-stable mobile: text + native keyboard dictation (custom mic UI dormant). */
  const simpleMobileUi = useSyncExternalStore(
    () => () => {},
    () => guestStaySimpleMobileUiPreferred(),
    () => false,
  );

  const cancelMobileStt = () => {
    mobileAbortRef.current?.abort();
    mobileAbortRef.current = null;
    mobileSessionRef.current?.cancel();
    mobileSessionRef.current = null;
    mobileRecordingRef.current = false;
    mobileProcessingRef.current = false;
    mobileStartingRef.current = false;
    if (mountedRef.current) {
      setMobileRecording(false);
      setMobileProcessing(false);
      setMobileStarting(false);
    }
  };

  const clearListenRearmTimer = () => {
    if (listenRearmTimerRef.current == null) return;
    window.clearTimeout(listenRearmTimerRef.current);
    listenRearmTimerRef.current = null;
  };

  const scheduleListenRearmAfterReply = (ownerGeneration: number, replyOwner: number) => {
    // R4: iOS post-TTS programmatic rearm can zombie (onstart, no onresult). Return to Tap to talk.
    if (!guestStayPostSpeechListenRearmEnabled()) {
      clearListenRearmTimer();
      pendingReplySpeechRearmRef.current = null;
      listenEngineRef.current.abort();
      if (mountedRef.current) {
        setListenStatus(listenSupport === "idle" ? "idle" : listenSupport);
      }
      return;
    }
    if (
      !guestStayShouldScheduleListenRearm({
        mounted: mountedRef.current,
        chatOwner: ownerGeneration,
        chatCurrent: generationRef.current,
        replyOwner,
        replyCurrent: replyVoiceGenerationRef.current,
        alreadyClaimedReplyOwner: listenRearmClaimedReplyRef.current,
        allowAutoRearm: true,
      })
    ) {
      return;
    }
    listenRearmClaimedReplyRef.current = replyOwner;
    clearListenRearmTimer();
    const rearmDelayMs = guestStayPostSpeechRearmDelayMs(listenLangRef.current);
    listenRearmTimerRef.current = window.setTimeout(() => {
      listenRearmTimerRef.current = null;
      if (
        !guestStayShouldStartListenRearm({
          mounted: mountedRef.current,
          chatOwner: ownerGeneration,
          chatCurrent: generationRef.current,
          replyOwner,
          replyCurrent: replyVoiceGenerationRef.current,
          welcomeLoading: welcomeLoadingRef.current,
          welcomeSpeaking: welcomeSpeakingRef.current,
          sending: sendingRef.current || inFlightRef.current !== null,
          alreadyListening: listenEngineRef.current.listening(),
          speechSpeaking:
            speechEngineRef.current.status() === "speaking" || audioEngineRef.current.isPlaying(),
          listenCanStart: guestStayListenCanStart(readGuestStayListenSupport()),
        })
      ) {
        return;
      }
      startListeningRef.current();
    }, rearmDelayMs);
  };

  const speechSynth = () => {
    const base = speechSynthRef.current;
    return {
      ...base,
      speak(utterance: Parameters<typeof base.speak>[0]) {
        return base.speak({
          ...utterance,
          onEnd: (generation) => {
            speechEngineRef.current.handleEnd(generation);
            if (mountedRef.current) setSpeechStatus(speechEngineRef.current.status());
            const pending = pendingReplySpeechRearmRef.current;
            if (!pending) return;
            pendingReplySpeechRearmRef.current = null;
            scheduleListenRearmAfterReply(pending.chatOwner, pending.replyOwner);
          },
          onError: (generation) => {
            speechEngineRef.current.handleError(generation);
            if (mountedRef.current) setSpeechStatus(speechEngineRef.current.status());
            pendingReplySpeechRearmRef.current = null;
          },
        });
      },
    };
  };

  useEffect(() => {
    mountedRef.current = true;
    const speechEngine = speechEngineRef.current;
    const speechSynthInstance = speechSynthRef.current;
    const listenEngine = listenEngineRef.current;
    const audioEngine = audioEngineRef.current;
    const urls = audioUrlsRef.current;
    const welcomeEngine = welcomeEngineRef.current;
    const welcomeUrls = welcomeUrlsRef.current;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      replyVoiceGenerationRef.current += 1;
      welcomeGenRef.current += 1;
      inFlightRef.current = null;
      sendingRef.current = false;
      serverVoiceLoadingRef.current = false;
      pendingReplySpeechRearmRef.current = null;
      listenRearmClaimedReplyRef.current = null;
      if (listenRearmTimerRef.current != null) {
        window.clearTimeout(listenRearmTimerRef.current);
        listenRearmTimerRef.current = null;
      }
      if (mobileMicHintTimerRef.current != null) {
        window.clearTimeout(mobileMicHintTimerRef.current);
        mobileMicHintTimerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      ttsAbortRef.current?.abort();
      ttsAbortRef.current = null;
      welcomeAbortRef.current?.abort();
      welcomeAbortRef.current = null;
      mobileAbortRef.current?.abort();
      mobileAbortRef.current = null;
      mobileSessionRef.current?.cancel();
      mobileSessionRef.current = null;
      listenEngine.abort();
      audioEngine.reset(audioElRef.current, urls);
      welcomeEngine.reset(welcomeElRef.current, welcomeUrls);
      speechEngine.unmount(speechSynthInstance);
    };
  }, []);

  const releaseInFlight = (gen: number) => {
    if (inFlightRef.current === gen) {
      inFlightRef.current = null;
      sendingRef.current = false;
    }
  };

  const isCurrentGeneration = (gen: number) => mountedRef.current && gen === generationRef.current;

  const isCurrentReplyVoice = (chatOwner: number, replyOwner: number) =>
    guestStayIsCurrentReplyVoice({
      mounted: mountedRef.current,
      chatOwner,
      chatCurrent: generationRef.current,
      replyOwner,
      replyCurrent: replyVoiceGenerationRef.current,
    });

  const speakAssistantReply = (text: string, lang: "en" | "es") => {
    if (!shouldSpeakGuestStayText("elena", text)) return { started: false as const };
    const result = speechEngineRef.current.speak(text, lang, speechSynth());
    if (mountedRef.current) setSpeechStatus(result.status);
    return result;
  };

  const haltServerVoiceLoading = () => {
    serverVoiceLoadingRef.current = false;
    if (mountedRef.current) setServerVoiceLoading(false);
  };

  const beginServerVoiceLoading = (ownerGeneration: number, replyOwner: number) => {
    if (!isCurrentReplyVoice(ownerGeneration, replyOwner)) return;
    serverVoiceLoadingRef.current = true;
    setServerVoiceLoading(true);
  };

  const finishServerVoiceLoading = (
    ownerGeneration: number,
    replyOwner: number,
    controller: AbortController,
  ) => {
    const finish = guestStayFinishReplyVoiceLoading({
      mounted: mountedRef.current,
      chatOwner: ownerGeneration,
      chatCurrent: generationRef.current,
      replyOwner,
      replyCurrent: replyVoiceGenerationRef.current,
      superseded: ttsAbortRef.current !== controller,
    });
    if (!finish) return false;
    serverVoiceLoadingRef.current = false;
    setServerVoiceLoading(false);
    return true;
  };

  const resetServerAudio = () => {
    if (!audioElRef.current) audioElRef.current = guestStayBrowserAudioElement();
    audioEngineRef.current.reset(audioElRef.current, audioUrlsRef.current);
  };

  const resetWelcomeAudio = () => {
    if (!welcomeElRef.current) welcomeElRef.current = guestStayBrowserAudioElement();
    welcomeEngineRef.current.reset(welcomeElRef.current, welcomeUrlsRef.current);
  };

  const abortStayTts = () => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
  };

  const abortWelcomeTts = () => {
    welcomeAbortRef.current?.abort();
    welcomeAbortRef.current = null;
  };

  const haltWelcome = () => {
    abortWelcomeTts();
    welcomeGenRef.current += 1;
    welcomeLoadingRef.current = false;
    welcomeSpeakingRef.current = false;
    welcomeFallbackGenRef.current = null;
    if (mountedRef.current) {
      setWelcomeLoading(false);
      setWelcomeSpeaking(false);
    }
    resetWelcomeAudio();
  };

  const isCurrentWelcome = (gen: number) => mountedRef.current && gen === welcomeGenRef.current;

  const haltChatVoice = () => {
    replyVoiceGenerationRef.current += 1;
    abortStayTts();
    speechFallbackGenRef.current = null;
    pendingReplySpeechRearmRef.current = null;
    clearListenRearmTimer();
    resetServerAudio();
    speechEngineRef.current.cancelForSend(speechSynthRef.current);
    serverVoiceLoadingRef.current = false;
    if (mountedRef.current) {
      setServerVoiceLoading(false);
      setSpeechStatus(speechEngineRef.current.status() === "unavailable" ? "unavailable" : "idle");
    }
  };

  const haltVoice = () => {
    haltChatVoice();
    haltWelcome();
  };

  const playWelcomeFallback = (ownerGeneration: number, lang: "en" | "es") => {
    if (!isCurrentWelcome(ownerGeneration)) return;
    if (welcomeLoadingRef.current) return;
    if (welcomeFallbackGenRef.current === ownerGeneration) return;
    if (!welcomeElRef.current) welcomeElRef.current = guestStayBrowserAudioElement();
    welcomeEngineRef.current.discard(welcomeElRef.current, welcomeUrlsRef.current);
    speechEngineRef.current.cancelForSend(speechSynthRef.current);
    welcomeFallbackGenRef.current = ownerGeneration;
    speakAssistantReply(lang === "es" ? GUEST_STAY_WELCOME_COPY.textEs : GUEST_STAY_WELCOME_COPY.textEn, lang);
  };

  const playBrowserFallback = (ownerGeneration: number, replyOwner: number) => {
    if (!isCurrentReplyVoice(ownerGeneration, replyOwner)) return;
    if (serverVoiceLoadingRef.current) return;
    if (speechFallbackGenRef.current === replyOwner) return;
    if (!audioElRef.current) audioElRef.current = guestStayBrowserAudioElement();
    abortListening();
    audioEngineRef.current.discard(audioElRef.current, audioUrlsRef.current);
    speechEngineRef.current.cancelForSend(speechSynthRef.current);
    speechFallbackGenRef.current = replyOwner;
    const latest = lastAssistantRef.current;
    if (!latest) return;
    pendingReplySpeechRearmRef.current = { chatOwner: ownerGeneration, replyOwner };
    const spoken = speakAssistantReply(latest.text, latest.lang);
    if (!spoken.started) {
      pendingReplySpeechRearmRef.current = null;
      scheduleListenRearmAfterReply(ownerGeneration, replyOwner);
    }
  };

  const requestStayAudio = async (ownerGeneration: number, message: string) => {
    haltWelcome();
    if (
      !shouldFetchGuestStayAudio({
        mounted: mountedRef.current,
        ownerGeneration,
        currentGeneration: generationRef.current,
        chatSucceeded: true,
      })
    ) {
      return;
    }
    abortListening();
    replyVoiceGenerationRef.current += 1;
    const replyOwner = replyVoiceGenerationRef.current;
    abortStayTts();
    resetServerAudio();
    speechEngineRef.current.cancelForSend(speechSynthRef.current);
    const controller = new AbortController();
    ttsAbortRef.current = controller;
    beginServerVoiceLoading(ownerGeneration, replyOwner);
    try {
      const response = await fetch(
        publicApiUrl(GUEST_STAY_AUDIO_PATH),
        guestStayAudioPostInit(JSON.stringify(guestStayChatRequestBody(token, message, listenLangRef.current)), controller.signal),
      );
      if (!isCurrentReplyVoice(ownerGeneration, replyOwner)) return;
      const blob = await guestStayAudioBlobFromResponse(response);
      if (!isCurrentReplyVoice(ownerGeneration, replyOwner)) return;
      if (!blob) {
        if (finishServerVoiceLoading(ownerGeneration, replyOwner, controller)) {
          playBrowserFallback(ownerGeneration, replyOwner);
        }
        return;
      }
      if (!audioElRef.current) audioElRef.current = guestStayBrowserAudioElement();
      const audio = audioElRef.current;
      if (!audio) {
        if (finishServerVoiceLoading(ownerGeneration, replyOwner, controller)) {
          playBrowserFallback(ownerGeneration, replyOwner);
        }
        return;
      }
      if (!isCurrentReplyVoice(ownerGeneration, replyOwner)) return;
      abortListening();
      speechEngineRef.current.cancelForSend(speechSynthRef.current);
      const outcome = await audioEngineRef.current.installAndAutoplay({
        ownerGeneration,
        isCurrent: (chatOwner) => isCurrentReplyVoice(chatOwner, replyOwner),
        blob,
        urls: audioUrlsRef.current,
        audio,
        onEnded: (endedGen) => {
          if (!isCurrentReplyVoice(endedGen, replyOwner)) return;
          setSpeechStatus(speechEngineRef.current.status() === "unavailable" ? "unavailable" : "idle");
          // R5: release completed reply TTS before any future SpeechRecognition start (iOS audio-session hygiene).
          audioEngineRef.current.discard(audioElRef.current, audioUrlsRef.current);
          scheduleListenRearmAfterReply(endedGen, replyOwner);
        },
        onError: (errorGen) => {
          if (!isCurrentReplyVoice(errorGen, replyOwner)) return;
          playBrowserFallback(errorGen, replyOwner);
        },
      });
      if (!isCurrentReplyVoice(ownerGeneration, replyOwner)) return;
      if (outcome === "playing") {
        speechEngineRef.current.cancelForSend(speechSynthRef.current);
        finishServerVoiceLoading(ownerGeneration, replyOwner, controller);
        setSpeechStatus("speaking");
        return;
      }
      if (outcome === "retained") {
        finishServerVoiceLoading(ownerGeneration, replyOwner, controller);
        setSpeechStatus("idle");
        return;
      }
      if (outcome === "stale") {
        finishServerVoiceLoading(ownerGeneration, replyOwner, controller);
        return;
      }
      if (finishServerVoiceLoading(ownerGeneration, replyOwner, controller)) {
        playBrowserFallback(ownerGeneration, replyOwner);
      }
    } catch {
      if (!isCurrentReplyVoice(ownerGeneration, replyOwner) || controller.signal.aborted) {
        finishServerVoiceLoading(ownerGeneration, replyOwner, controller);
        return;
      }
      if (finishServerVoiceLoading(ownerGeneration, replyOwner, controller)) {
        playBrowserFallback(ownerGeneration, replyOwner);
      }
    }
  };

  const finishWelcomeLoading = (ownerGeneration: number, controller: AbortController) => {
    const finish = guestStayFinishServerVoiceLoading({
      mounted: mountedRef.current,
      ownerGeneration,
      currentGeneration: welcomeGenRef.current,
      superseded: welcomeAbortRef.current !== controller,
    });
    if (!finish) return false;
    welcomeLoadingRef.current = false;
    setWelcomeLoading(false);
    return true;
  };

  const requestWelcomeAudio = async () => {
    abortListening();
    haltChatVoice();
    abortWelcomeTts();
    if (!welcomeElRef.current) welcomeElRef.current = guestStayBrowserAudioElement();
    welcomeEngineRef.current.reset(welcomeElRef.current, welcomeUrlsRef.current);
    welcomeGenRef.current += 1;
    const ownerGeneration = welcomeGenRef.current;
    welcomeFallbackGenRef.current = null;
    const lang = listenLangRef.current;
    const controller = new AbortController();
    welcomeAbortRef.current = controller;
    welcomeLoadingRef.current = true;
    welcomeSpeakingRef.current = false;
    setWelcomeLoading(true);
    setWelcomeSpeaking(false);
    try {
      const response = await fetch(
        publicApiUrl(GUEST_STAY_WELCOME_TTS_PATH),
        guestStayAudioPostInit(JSON.stringify(guestStayWelcomeRequestBody(token, lang)), controller.signal),
      );
      if (!isCurrentWelcome(ownerGeneration)) return;
      const blob = await guestStayAudioBlobFromResponse(response);
      if (!isCurrentWelcome(ownerGeneration)) return;
      if (!blob) {
        if (finishWelcomeLoading(ownerGeneration, controller)) playWelcomeFallback(ownerGeneration, lang);
        return;
      }
      const audio = welcomeElRef.current;
      if (!audio) {
        if (finishWelcomeLoading(ownerGeneration, controller)) playWelcomeFallback(ownerGeneration, lang);
        return;
      }
      speechEngineRef.current.cancelForSend(speechSynthRef.current);
      const outcome = await welcomeEngineRef.current.installAndAutoplay({
        ownerGeneration,
        isCurrent: isCurrentWelcome,
        blob,
        urls: welcomeUrlsRef.current,
        audio,
        onEnded: (endedGen) => {
          if (!isCurrentWelcome(endedGen)) return;
          welcomeSpeakingRef.current = false;
          setWelcomeSpeaking(false);
        },
        onError: (errorGen) => {
          if (!isCurrentWelcome(errorGen)) return;
          welcomeSpeakingRef.current = false;
          setWelcomeSpeaking(false);
          playWelcomeFallback(errorGen, lang);
        },
      });
      if (!isCurrentWelcome(ownerGeneration)) return;
      if (outcome === "playing") {
        speechEngineRef.current.cancelForSend(speechSynthRef.current);
        finishWelcomeLoading(ownerGeneration, controller);
        welcomeSpeakingRef.current = true;
        setWelcomeSpeaking(true);
        return;
      }
      if (outcome === "retained") {
        finishWelcomeLoading(ownerGeneration, controller);
        welcomeSpeakingRef.current = false;
        setWelcomeSpeaking(false);
        return;
      }
      if (outcome === "stale") {
        finishWelcomeLoading(ownerGeneration, controller);
        return;
      }
      if (finishWelcomeLoading(ownerGeneration, controller)) playWelcomeFallback(ownerGeneration, lang);
    } catch {
      if (!isCurrentWelcome(ownerGeneration) || controller.signal.aborted) {
        finishWelcomeLoading(ownerGeneration, controller);
        return;
      }
      if (finishWelcomeLoading(ownerGeneration, controller)) playWelcomeFallback(ownerGeneration, lang);
    }
  };

  const onWelcomeButtonClick = () => {
    if (welcomeLoadingRef.current) return;
    if (welcomeSpeakingRef.current) {
      welcomeEngineRef.current.stop(welcomeElRef.current);
      welcomeSpeakingRef.current = false;
      setWelcomeSpeaking(false);
      return;
    }
    if (welcomeEngineRef.current.hasUsableClip() && welcomeElRef.current) {
      abortListening();
      haltChatVoice();
      const gen = welcomeGenRef.current;
      void (async () => {
        speechEngineRef.current.cancelForSend(speechSynthRef.current);
        const played = await welcomeEngineRef.current.playManual({
          ownerGeneration: gen,
          isCurrent: isCurrentWelcome,
          audio: welcomeElRef.current!,
        });
        if (!isCurrentWelcome(gen)) return;
        if (played === "playing") {
          welcomeSpeakingRef.current = true;
          setWelcomeSpeaking(true);
        }
      })();
      return;
    }
    void requestWelcomeAudio();
  };

  const abortListening = () => {
    cancelMobileStt();
    listenEngineRef.current.abort();
    if (mountedRef.current) {
      setListenStatus(listenSupport === "idle" ? "idle" : listenSupport);
    }
  };

  const finalizeMobileRecordingAndSend = async () => {
    const session = mobileSessionRef.current;
    if (!session || mobileProcessingRef.current || !mobileRecordingRef.current) return;
    mobileRecordingRef.current = false;
    mobileProcessingRef.current = true;
    if (mountedRef.current) {
      setMobileRecording(false);
      setMobileProcessing(true);
      setMobileSttFail(null);
    }
    mobileSessionRef.current = null;
    const controller = new AbortController();
    mobileAbortRef.current = controller;
    try {
      const blob = await session.stop();
      if (!mountedRef.current || controller.signal.aborted) {
        releaseAfterMobileAttempt();
        return;
      }
      const result = await postGuestStayMobileTranscribe({
        token,
        blob,
        fetch,
        apiUrl: publicApiUrl,
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) {
        releaseAfterMobileAttempt();
        return;
      }
      if (!result.ok) {
        if (mountedRef.current) setMobileSttFail("hear");
        releaseAfterMobileAttempt();
        return;
      }
      releaseAfterMobileAttempt();
      if (sendingRef.current || inFlightRef.current !== null) {
        inputRef.current = result.transcript;
        setInput(result.transcript);
        return;
      }
      void sendRef.current(result.transcript);
    } catch {
      if (mountedRef.current && !controller.signal.aborted) setMobileSttFail("hear");
      releaseAfterMobileAttempt();
    }
  };

  const releaseAfterMobileAttempt = () => {
    mobileAbortRef.current = null;
    mobileSessionRef.current = null;
    mobileRecordingRef.current = false;
    mobileProcessingRef.current = false;
    mobileStartingRef.current = false;
    if (mountedRef.current) {
      setMobileRecording(false);
      setMobileProcessing(false);
      setMobileStarting(false);
    }
  };

  const startMobileRecording = async () => {
    if (
      mobileRecordingRef.current ||
      mobileProcessingRef.current ||
      mobileStartingRef.current
    ) {
      return;
    }
    if (guestStayTapBlockedByWelcome({ welcomeLoading: welcomeLoadingRef.current, welcomeSpeaking: welcomeSpeakingRef.current })) {
      return;
    }
    if (sendingRef.current || inFlightRef.current !== null) return;
    clearListenRearmTimer();
    pendingReplySpeechRearmRef.current = null;
    listenEngineRef.current.abort();
    haltVoice();
    mobileStartingRef.current = true;
    if (mountedRef.current) {
      setSpeechStatus(speechEngineRef.current.status());
      setMobileSttFail(null);
      setMobileStarting(true);
    }
    guestStayMobileSttDevDiag({
      event: "ui-tap-start",
      platform: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 48) : "unknown",
    });
    try {
      const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
      if (!mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        cancelMobileStt();
        if (mountedRef.current) setMobileSttFail("recorder");
        return;
      }
      const session = await startGuestStayMobileSttSession({
        getUserMedia: (constraints) => mediaDevices.getUserMedia(constraints),
        MediaRecorderCtor: MediaRecorder,
        isTypeSupported: (mime) => MediaRecorder.isTypeSupported(mime),
        onRecordingStarted: () => {
          mobileStartingRef.current = false;
          mobileRecordingRef.current = true;
          if (mountedRef.current) {
            setMobileStarting(false);
            setMobileRecording(true);
          }
        },
        onAutoStop: () => {
          void finalizeMobileRecordingAndSend();
        },
      });
      if (!mountedRef.current) {
        session.cancel();
        return;
      }
      mobileSessionRef.current = session;
      // Recording UI is set from onRecordingStarted (after MediaRecorder onstart).
      if (!mobileRecordingRef.current) {
        mobileStartingRef.current = false;
        mobileRecordingRef.current = true;
        setMobileStarting(false);
        setMobileRecording(true);
      }
    } catch (cause) {
      const kind =
        cause instanceof GuestStayMobileSttStartupError
          ? cause.kind
          : classifyGuestStayMobileMicError(cause);
      cancelMobileStt();
      if (mountedRef.current) setMobileSttFail(kind === "permission" ? "permission" : "recorder");
    }
  };

  const onPrimaryVoiceClick = () => {
    if (mobileServerStt) {
      if (mobileProcessingRef.current || mobileStartingRef.current) return;
      if (mobileRecordingRef.current) {
        void finalizeMobileRecordingAndSend();
        return;
      }
      void startMobileRecording();
      return;
    }
    startListening();
  };

  const startListening = (lang: GuestStayListenLang = listenLangRef.current) => {
    if (mobileServerStt) {
      void startMobileRecording();
      return;
    }
    listenLangRef.current = lang;
    if (!guestStayListenCanStart(listenSupport)) return;
    if (guestStayTapBlockedByWelcome({ welcomeLoading: welcomeLoadingRef.current, welcomeSpeaking: welcomeSpeakingRef.current })) {
      return;
    }
    clearListenRearmTimer();
    pendingReplySpeechRearmRef.current = null;
    haltVoice();
    if (mountedRef.current) setSpeechStatus(speechEngineRef.current.status());
    const result = listenEngineRef.current.start({
      lang,
      ctor: getGuestStaySpeechRecognitionCtor(),
      isBrowser: typeof window !== "undefined",
      isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
      onFinal: (text, generation) => {
        if (!mountedRef.current || generation !== listenEngineRef.current.generation()) return;
        const message = guestStayFinalListenSendText(inputRef.current, text);
        if (!message) return;
        if (sendingRef.current || inFlightRef.current !== null) {
          inputRef.current = message;
          setInput(message);
          return;
        }
        void sendRef.current(message);
      },
      onStatus: (status, generation) => {
        if (!mountedRef.current || generation !== listenEngineRef.current.generation()) return;
        setListenStatus(status);
      },
    });
    if (mountedRef.current) setListenStatus(result.status);
  };

  const selectListenLang = (next: GuestStayListenLang) => {
    if (listenLangRef.current === next) return;

    listenLangRef.current = next;
    setListenLang(next);

    abortListening();
    clearListenRearmTimer();
    pendingReplySpeechRearmRef.current = null;
    haltChatVoice();

    if (mountedRef.current) {
      setSpeechStatus(speechEngineRef.current.status());
    }

    haltWelcome();

    // IMPORTANT:
    // Do NOT auto-restart listening here.
    // The next manual Tap starts a fresh SpeechRecognition / mobile STT session
    // using the newly selected language preference for chat/copy.
  };

  const clearChat = () => {
    generationRef.current += 1;
    replyVoiceGenerationRef.current += 1;
    welcomeGenRef.current += 1;
    listenEngineRef.current.advanceGeneration();
    inFlightRef.current = null;
    sendingRef.current = false;
    seqRef.current = 0;
    pendingReplySpeechRearmRef.current = null;
    listenRearmClaimedReplyRef.current = null;
    clearListenRearmTimer();
    if (mountedRef.current) {
      const ui = guestStayChatClearedUi({ includeGreeting: !simpleMobileUi });
      setMessages(ui.messages);
      setInput(ui.input);
      inputRef.current = ui.input;
      setSending(ui.sending);
      setError(ui.error);
      setRetryMessage(ui.retryMessage);
      setSpeechStatus(ui.speechStatus);
      setListenStatus(ui.listenStatus);
      lastAssistantRef.current = null;
      haltServerVoiceLoading();
      welcomeLoadingRef.current = false;
      welcomeSpeakingRef.current = false;
      setWelcomeLoading(false);
      setWelcomeSpeaking(false);
      mobileRecordingRef.current = false;
      mobileProcessingRef.current = false;
      mobileStartingRef.current = false;
      setMobileRecording(false);
      setMobileProcessing(false);
      setMobileStarting(false);
      setMobileSttFail(null);
    }
    swallowGuestStayChatCleanup(() => {
      abortRef.current?.abort();
      abortRef.current = null;
      ttsAbortRef.current?.abort();
      ttsAbortRef.current = null;
      welcomeAbortRef.current?.abort();
      welcomeAbortRef.current = null;
      mobileAbortRef.current?.abort();
      mobileAbortRef.current = null;
      mobileSessionRef.current?.cancel();
      mobileSessionRef.current = null;
      listenEngineRef.current.abort();
      audioEngineRef.current.reset(audioElRef.current, audioUrlsRef.current);
      welcomeEngineRef.current.reset(welcomeElRef.current, welcomeUrlsRef.current);
      speechEngineRef.current.unmount(speechSynthRef.current);
      speechEngineRef.current = createGuestStaySpeechEngine();
    });
  };

  const send = async (raw: string) => {
    const message = raw.trim();
    if (sendingRef.current || inFlightRef.current !== null) return;
    if (!canStartGuestStayChatSend({ sending: false, message })) return;
    const gen = generationRef.current + 1;
    generationRef.current = gen;
    inFlightRef.current = gen;
    sendingRef.current = true;
    haltVoice();
    const controller = new AbortController();
    abortRef.current = controller;
    seqRef.current += 1;
    const guestId = `guest-${seqRef.current}`;
    abortListening();
    if (isCurrentGeneration(gen)) {
      setSpeechStatus(speechEngineRef.current.status());
      setSending(true);
      setError(false);
      setRetryMessage(null);
      setInput("");
      inputRef.current = "";
      setMessages((current) =>
        appendGuestStayChatMessageIfCurrent({
          current,
          next: { id: guestId, role: "guest", text: message },
          isCurrent: isCurrentGeneration(gen),
        }),
      );
    }

    try {
      const response = await fetch(publicApiUrl("/api/guest/stay-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify(guestStayChatRequestBody(token, message, listenLangRef.current)),
      });
      const payload = (await response.json()) as { reply?: unknown; lang?: unknown };
      const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
      if (!response.ok || !reply) throw new Error("unavailable");
      releaseInFlight(gen);
      if (!isCurrentGeneration(gen)) return;
      seqRef.current += 1;
      const elenaId = `elena-${seqRef.current}`;
      setMessages((current) =>
        appendGuestStayChatMessageIfCurrent({
          current,
          next: { id: elenaId, role: "elena", text: reply },
          isCurrent: isCurrentGeneration(gen),
        }),
      );
      if (!isCurrentGeneration(gen)) return;
      setError(false);
      setSending(false);
      setMobileDictateCollapsed(true);
      const lang = parseGuestStaySpeechLang(payload.lang);
      lastAssistantRef.current = { text: reply, lang };
      void requestStayAudio(gen, message);
    } catch {
      const aborted = controller.signal.aborted;
      releaseInFlight(gen);
      if (!isCurrentGeneration(gen)) return;
      setSending(false);
      if (!aborted) {
        if (!isCurrentGeneration(gen)) return;
        setError(true);
        setRetryMessage(message);
        setInput((current) => {
          const next = restoreGuestStayChatInput({
            mounted: mountedRef.current,
            isCurrentGeneration: isCurrentGeneration(gen),
            currentInput: current,
            originalMessage: message,
          });
          inputRef.current = next;
          return next;
        });
      }
    }
  };

  useLayoutEffect(() => {
    sendRef.current = send;
    startListeningRef.current = startListening;
  });

  const voiceControl = guestStayVoiceControlMode({ messages, speechStatus, serverVoiceLoading });
  const mobileVoiceMode = guestStayMobileSttUiMode({
    starting: mobileStarting,
    recording: mobileRecording,
    processing: mobileProcessing,
  });
  // Mobile Server-STT / Web Speech Tap remain implemented but are not exposed on simplified mobile UI.
  const showMobileServerStt = !simpleMobileUi && mobileServerStt;
  const showCustomVoiceInput = !simpleMobileUi;
  const mobilePlaceholder =
    listenLang === "es"
      ? GUEST_STAY_SIMPLE_MOBILE_COPY.placeholderEs
      : GUEST_STAY_SIMPLE_MOBILE_COPY.placeholderEn;
  const onSimpleMobileQuickAction = (id: GuestStaySimpleMobileQuickActionId) => {
    if (sendingRef.current || inFlightRef.current !== null) return;
    if (id === "access") {
      focusGuestStayAccessSection();
      return;
    }
    void sendRef.current(guestStaySimpleMobileQuickActionMessage(id, listenLangRef.current));
  };

  /** Visual hint only — focuses the input; never starts MediaRecorder or Web Speech. */
  const onDictateMicHintClick = () => {
    messageInputElRef.current?.focus();
    setMobileMicHintVisible(true);
    if (mobileMicHintTimerRef.current != null) {
      window.clearTimeout(mobileMicHintTimerRef.current);
    }
    mobileMicHintTimerRef.current = window.setTimeout(() => {
      mobileMicHintTimerRef.current = null;
      if (mountedRef.current) setMobileMicHintVisible(false);
    }, 4500);
  };

  const welcomeControls = (
    <div className={showMobileServerStt ? "mt-3" : "mt-4"}>
      {guestStayWelcomeControlMode({ loading: welcomeLoading, speaking: welcomeSpeaking }) === "preparing" ? (
        <button
          type="button"
          disabled
          className="min-h-11 w-full rounded-lg border border-cyan-400/30 bg-[#082238] px-4 py-2 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-40"
        >
          {GUEST_STAY_WELCOME_COPY.preparingEn} / {GUEST_STAY_WELCOME_COPY.preparingEs}
        </button>
      ) : guestStayWelcomeControlMode({ loading: welcomeLoading, speaking: welcomeSpeaking }) === "stop" ? (
        <button
          type="button"
          onClick={onWelcomeButtonClick}
          className="min-h-11 w-full rounded-lg border border-cyan-400/30 bg-[#082238] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0a2f4c]"
        >
          {GUEST_STAY_WELCOME_COPY.stopEn} / {GUEST_STAY_WELCOME_COPY.stopEs}
        </button>
      ) : (
        <button
          type="button"
          onClick={onWelcomeButtonClick}
          className={
            showMobileServerStt
              ? "min-h-11 w-full rounded-lg border border-cyan-400/25 bg-transparent px-4 py-2 text-sm font-medium text-slate-200 hover:bg-[#0a2f4c]/60"
              : "min-h-11 w-full rounded-lg border border-[#8FBE9B] bg-[#A7CDB1] px-4 py-2 text-sm font-semibold text-slate-950 outline-none hover:bg-[#BBDCC3] focus-visible:ring-2 focus-visible:ring-[#BBDCC3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d3258]"
          }
        >
          {GUEST_STAY_WELCOME_COPY.hearEn} / {GUEST_STAY_WELCOME_COPY.hearEs}
        </button>
      )}
    </div>
  );

  return (
    <section
      aria-labelledby="guest-elena-title-en"
      className="mt-8 w-full min-w-0 max-w-full overflow-x-hidden rounded-2xl border border-cyan-400/25 bg-[#0d3258]/90 p-4 text-white shadow-xl shadow-cyan-950/30 sm:p-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <ElenaAvatar size={52} />
        <div className="min-w-0 leading-tight">
          <h2 id="guest-elena-title-en" className="truncate text-base font-bold sm:text-lg">
            {listenLang === "es" && simpleMobileUi
              ? GUEST_ELENA_TEXT_COPY.titleEs
              : GUEST_ELENA_TEXT_COPY.titleEn}
          </h2>
          {simpleMobileUi ? null : (
            <>
              <p className="truncate text-sm text-cyan-200/85">{GUEST_ELENA_TEXT_COPY.titleEs}</p>
              <p className="mt-1 text-[11px] text-slate-300">{GUEST_ELENA_TEXT_COPY.subtitleEn}</p>
              <p className="text-[11px] text-cyan-200/75">{GUEST_ELENA_TEXT_COPY.subtitleEs}</p>
            </>
          )}
        </div>
      </div>

      {simpleMobileUi ? null : (
        <>
          <p className="mt-4 text-xs leading-relaxed text-slate-300">{GUEST_ELENA_TEXT_COPY.privacyEn}</p>
          <p className="mt-1 text-xs leading-relaxed text-cyan-200/80">{GUEST_ELENA_TEXT_COPY.privacyEs}</p>
        </>
      )}
      {simpleMobileUi ? (
        <p className="mt-4 text-xs leading-relaxed text-slate-300">
          {listenLang === "es" ? GUEST_ELENA_TEXT_COPY.privacyEs : GUEST_ELENA_TEXT_COPY.privacyEn}
        </p>
      ) : null}
      {showCustomVoiceInput ? (
        showMobileServerStt ? (
          <>
            <p className="mt-3 text-xs leading-relaxed text-slate-300">{GUEST_STAY_MOBILE_STT_COPY.privacyEn}</p>
            <p className="mt-1 text-xs leading-relaxed text-cyan-200/80">{GUEST_STAY_MOBILE_STT_COPY.privacyEs}</p>
          </>
        ) : (
          <>
            <p className="mt-3 text-xs leading-relaxed text-slate-300">{GUEST_STAY_LISTEN_COPY.privacyEn}</p>
            <p className="mt-1 text-xs leading-relaxed text-cyan-200/80">{GUEST_STAY_LISTEN_COPY.privacyEs}</p>
          </>
        )
      ) : null}

      <div className="mt-3">
        {simpleMobileUi ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
            {listenLang === "es"
              ? GUEST_STAY_SIMPLE_MOBILE_COPY.replyLangEs
              : GUEST_STAY_SIMPLE_MOBILE_COPY.replyLangEn}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={listenLang === "en"}
            onClick={() => selectListenLang("en")}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${
              listenLang === "en"
                ? "border-cyan-300 bg-cyan-400/20 text-cyan-50"
                : "border-cyan-400/30 bg-[#082238] text-slate-100 hover:bg-[#0a2f4c]"
            }`}
          >
            {GUEST_STAY_LISTEN_COPY.langEn}
          </button>
          <button
            type="button"
            aria-pressed={listenLang === "es"}
            onClick={() => selectListenLang("es")}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${
              listenLang === "es"
                ? "border-cyan-300 bg-cyan-400/20 text-cyan-50"
                : "border-cyan-400/30 bg-[#082238] text-slate-100 hover:bg-[#0a2f4c]"
            }`}
          >
            {GUEST_STAY_LISTEN_COPY.langEs}
          </button>
        </div>
      </div>

      {simpleMobileUi ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {GUEST_STAY_SIMPLE_MOBILE_QUICK_ACTIONS.map((id) => (
            <button
              key={id}
              type="button"
              disabled={sending}
              onClick={() => onSimpleMobileQuickAction(id)}
              className="min-h-11 rounded-lg border border-cyan-400/30 bg-[#082238] px-3 py-2 text-sm font-semibold text-cyan-50 hover:bg-[#0a2f4c] disabled:pointer-events-none disabled:opacity-50"
            >
              {guestStaySimpleMobileQuickActionLabel(id, listenLang)}
            </button>
          ))}
        </div>
      ) : null}

      {showCustomVoiceInput ? (
        showMobileServerStt ? (
          mobileVoiceMode === "processing" ? (
            <button
              type="button"
              disabled
              className="mt-2 min-h-11 w-full rounded-lg border border-cyan-400/30 bg-[#082238] px-4 py-2 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-60"
            >
              {GUEST_STAY_MOBILE_STT_COPY.processingEn} / {GUEST_STAY_MOBILE_STT_COPY.processingEs}
            </button>
          ) : mobileVoiceMode === "starting" ? (
            <button
              type="button"
              disabled
              className="mt-2 min-h-11 w-full rounded-lg border border-cyan-400/30 bg-[#082238] px-4 py-2 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-60"
            >
              {GUEST_STAY_MOBILE_STT_COPY.startingEn} / {GUEST_STAY_MOBILE_STT_COPY.startingEs}
            </button>
          ) : mobileVoiceMode === "stop-send" ? (
            <button
              type="button"
              onClick={onPrimaryVoiceClick}
              className="mt-2 min-h-11 w-full rounded-lg border border-amber-400/50 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/20"
            >
              {GUEST_STAY_MOBILE_STT_COPY.stopSendEn} / {GUEST_STAY_MOBILE_STT_COPY.stopSendEs}
            </button>
          ) : (
            <button
              type="button"
              disabled={guestStayTapBlockedByWelcome({ welcomeLoading, welcomeSpeaking }) || sending}
              onClick={onPrimaryVoiceClick}
              className="mt-2 min-h-11 w-full rounded-lg border border-[#8FBE9B] bg-[#A7CDB1] px-4 py-2 text-sm font-semibold text-slate-950 outline-none hover:bg-[#BBDCC3] focus-visible:ring-2 focus-visible:ring-[#BBDCC3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d3258] disabled:pointer-events-none disabled:opacity-60"
            >
              {GUEST_STAY_LISTEN_COPY.tapEn} / {GUEST_STAY_LISTEN_COPY.tapEs}
            </button>
          )
        ) : listenStatus === "listening" ? (
          <button
            type="button"
            onClick={() => {
              listenEngineRef.current.stop();
              if (mountedRef.current) setListenStatus("idle");
            }}
            className="mt-2 min-h-11 w-full rounded-lg border border-amber-400/50 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/20"
          >
            {GUEST_STAY_LISTEN_COPY.stopEn} / {GUEST_STAY_LISTEN_COPY.stopEs}
          </button>
        ) : (
          <button
            type="button"
            disabled={
              !guestStayListenCanStart(listenSupport) ||
              guestStayTapBlockedByWelcome({ welcomeLoading, welcomeSpeaking })
            }
            onClick={() => startListening()}
            className="mt-2 min-h-11 w-full rounded-lg border border-[#8FBE9B] bg-[#A7CDB1] px-4 py-2 text-sm font-semibold text-slate-950 outline-none hover:bg-[#BBDCC3] focus-visible:ring-2 focus-visible:ring-[#BBDCC3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d3258] disabled:pointer-events-none disabled:opacity-60"
          >
            {GUEST_STAY_LISTEN_COPY.tapEn} / {GUEST_STAY_LISTEN_COPY.tapEs}
          </button>
        )
      ) : null}

      {showCustomVoiceInput && showMobileServerStt && mobileSttFail === "permission" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_MOBILE_STT_COPY.failPermissionEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_MOBILE_STT_COPY.failPermissionEs}</p>
        </div>
      ) : null}
      {showCustomVoiceInput && showMobileServerStt && mobileSttFail === "recorder" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_MOBILE_STT_COPY.failRecorderEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_MOBILE_STT_COPY.failRecorderEs}</p>
        </div>
      ) : null}
      {showCustomVoiceInput && showMobileServerStt && mobileSttFail === "hear" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_MOBILE_STT_COPY.failHearEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_MOBILE_STT_COPY.failHearEs}</p>
        </div>
      ) : null}
      {showCustomVoiceInput && !showMobileServerStt && listenSupport === "insecure" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_LISTEN_COPY.httpsEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_LISTEN_COPY.httpsEs}</p>
        </div>
      ) : null}
      {showCustomVoiceInput &&
      !showMobileServerStt &&
      listenSupport !== "insecure" &&
      listenStatus === "permission" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_LISTEN_COPY.permissionEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_LISTEN_COPY.permissionEs}</p>
        </div>
      ) : null}
      {showCustomVoiceInput && !showMobileServerStt && listenStatus === "no-speech" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_LISTEN_COPY.noSpeechEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_LISTEN_COPY.noSpeechEs}</p>
        </div>
      ) : null}
      {showCustomVoiceInput && !showMobileServerStt && listenSupport === "unavailable" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_LISTEN_COPY.unavailableEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_LISTEN_COPY.unavailableEs}</p>
        </div>
      ) : null}
      {showCustomVoiceInput &&
      !showMobileServerStt &&
      listenSupport === "idle" &&
      listenStatus === "unavailable" ? (
        <div className="mt-2">
          <p className="text-xs text-amber-200">{GUEST_STAY_LISTEN_COPY.unavailableEn}</p>
          <p className="text-xs text-amber-200/80">{GUEST_STAY_LISTEN_COPY.unavailableEs}</p>
        </div>
      ) : null}

      {showCustomVoiceInput && !showMobileServerStt ? welcomeControls : null}

      <div
        role="log"
        aria-live="polite"
        className={`mt-4 space-y-2 overflow-y-auto rounded-xl border border-cyan-400/20 bg-[#071e36]/90 p-3 ${
          simpleMobileUi ? "max-h-72" : "max-h-64"
        }`}
      >
        {guestStayChatMessagesForDisplay(messages, {
          hideSeededGreeting: simpleMobileUi,
        }).map((bubble) => (
          <p
            key={bubble.id}
            className={
              bubble.role === "guest"
                ? "ml-4 whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-cyan-500/20 px-3 py-2 text-sm text-white"
                : "mr-4 whitespace-pre-wrap break-words rounded-2xl rounded-tl-md bg-[#123a62] px-3 py-2 text-sm text-slate-100"
            }
          >
            {bubble.text}
          </p>
        ))}
      </div>

      <button
        type="button"
        onClick={clearChat}
        className="mt-3 min-h-11 w-full rounded-lg border border-cyan-400/25 bg-[#082238] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-[#0a2f4c] hover:text-white"
      >
        {simpleMobileUi
          ? listenLang === "es"
            ? GUEST_ELENA_TEXT_COPY.clearEs
            : GUEST_ELENA_TEXT_COPY.clearEn
          : `${GUEST_ELENA_TEXT_COPY.clearEn} / ${GUEST_ELENA_TEXT_COPY.clearEs}`}
      </button>

      {voiceControl !== "hidden" ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-slate-300">
            {speechStatus === "speaking"
              ? simpleMobileUi
                ? listenLang === "es"
                  ? GUEST_ELENA_TEXT_COPY.speakingEs
                  : GUEST_ELENA_TEXT_COPY.speakingEn
                : `${GUEST_ELENA_TEXT_COPY.speakingEn} / ${GUEST_ELENA_TEXT_COPY.speakingEs}`
              : speechStatus === "stopped"
                ? simpleMobileUi
                  ? listenLang === "es"
                    ? GUEST_ELENA_TEXT_COPY.stoppedEs
                    : GUEST_ELENA_TEXT_COPY.stoppedEn
                  : `${GUEST_ELENA_TEXT_COPY.stoppedEn} / ${GUEST_ELENA_TEXT_COPY.stoppedEs}`
                : speechStatus === "unavailable"
                  ? simpleMobileUi
                    ? listenLang === "es"
                      ? GUEST_ELENA_TEXT_COPY.voiceUnavailableEs
                      : GUEST_ELENA_TEXT_COPY.voiceUnavailableEn
                    : `${GUEST_ELENA_TEXT_COPY.voiceUnavailableEn} / ${GUEST_ELENA_TEXT_COPY.voiceUnavailableEs}`
                  : null}
          </p>
          {voiceControl === "preparing" ? (
            <button
              type="button"
              disabled
              className="min-h-11 w-full rounded-lg border border-cyan-400/30 bg-[#082238] px-4 py-2 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-40"
            >
              {simpleMobileUi
                ? listenLang === "es"
                  ? GUEST_ELENA_TEXT_COPY.preparingVoiceEs
                  : GUEST_ELENA_TEXT_COPY.preparingVoiceEn
                : `${GUEST_ELENA_TEXT_COPY.preparingVoiceEn} / ${GUEST_ELENA_TEXT_COPY.preparingVoiceEs}`}
            </button>
          ) : voiceControl === "stop" ? (
            <button
              type="button"
              onClick={() => {
                haltWelcome();
                haltChatVoice();
                const next = speechEngineRef.current.stop(speechSynthRef.current);
                if (mountedRef.current) {
                  setSpeechStatus(next === "unavailable" ? "unavailable" : "stopped");
                }
              }}
              className="min-h-11 w-full rounded-lg border border-cyan-400/30 bg-[#082238] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0a2f4c]"
            >
              {simpleMobileUi
                ? listenLang === "es"
                  ? GUEST_ELENA_TEXT_COPY.stopEs
                  : GUEST_ELENA_TEXT_COPY.stopEn
                : `${GUEST_ELENA_TEXT_COPY.stopEn} / ${GUEST_ELENA_TEXT_COPY.stopEs}`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                haltWelcome();
                if (welcomeLoadingRef.current || welcomeSpeakingRef.current) return;
                if (serverVoiceLoadingRef.current) return;
                const chatGen = generationRef.current;
                const replyOwner = replyVoiceGenerationRef.current;
                void (async () => {
                  if (welcomeLoadingRef.current || welcomeSpeakingRef.current) return;
                  if (serverVoiceLoadingRef.current) return;
                  if (!isCurrentReplyVoice(chatGen, replyOwner)) return;
                  if (audioEngineRef.current.hasUsableClip() && audioElRef.current) {
                    speechEngineRef.current.cancelForSend(speechSynthRef.current);
                    const played = await audioEngineRef.current.playManual({
                      ownerGeneration: chatGen,
                      isCurrent: (owner) => isCurrentReplyVoice(owner, replyOwner),
                      audio: audioElRef.current,
                    });
                    if (!isCurrentReplyVoice(chatGen, replyOwner)) return;
                    if (played === "playing") {
                      setSpeechStatus("speaking");
                      return;
                    }
                  }
                  if (!isCurrentReplyVoice(chatGen, replyOwner)) return;
                  if (serverVoiceLoadingRef.current) return;
                  const latest = lastAssistantRef.current;
                  if (!latest) return;
                  speakAssistantReply(latest.text, latest.lang);
                })();
              }}
              className={
                simpleMobileUi || showMobileServerStt
                  ? "min-h-11 w-full rounded-lg border border-cyan-400/35 bg-cyan-400/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/25"
                  : "min-h-11 w-full rounded-lg border border-cyan-400/35 bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#062033] hover:bg-cyan-300"
              }
            >
              {simpleMobileUi
                ? listenLang === "es"
                  ? GUEST_STAY_SIMPLE_MOBILE_COPY.listenEs
                  : GUEST_STAY_SIMPLE_MOBILE_COPY.listenEn
                : `${GUEST_ELENA_TEXT_COPY.listenEn} / ${GUEST_ELENA_TEXT_COPY.listenEs}`}
            </button>
          )}
        </div>
      ) : null}

      <form
        className={`mt-4 flex w-full min-w-0 flex-col gap-2 ${
          simpleMobileUi ? "" : "sm:flex-row sm:items-end"
        }`}
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        {simpleMobileUi ? (
          <div className="rounded-xl border border-cyan-400/20 bg-[#071e36]/80 px-3 py-2.5">
            {guestStaySimpleMobileDictateCollapsed(mobileDictateCollapsed) ? (
              <p className="text-xs leading-snug text-slate-300">
                {listenLang === "es"
                  ? GUEST_STAY_SIMPLE_MOBILE_COPY.dictateCollapsedEs
                  : GUEST_STAY_SIMPLE_MOBILE_COPY.dictateCollapsedEn}
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-slate-300">
                {listenLang === "es"
                  ? GUEST_STAY_SIMPLE_MOBILE_COPY.dictateHelperEs
                  : GUEST_STAY_SIMPLE_MOBILE_COPY.dictateHelperEn}
              </p>
            )}
          </div>
        ) : null}
        <label className="sr-only" htmlFor="guest-elena-message">
          {simpleMobileUi ? mobilePlaceholder : GUEST_ELENA_TEXT_COPY.placeholderEn}
        </label>
        {simpleMobileUi ? (
          <div className="w-full min-w-0">
            <div className="relative w-full min-w-0">
              <input
                id="guest-elena-message"
                ref={messageInputElRef}
                type="text"
                name="message"
                autoComplete="off"
                enterKeyHint="send"
                maxLength={500}
                value={input}
                onChange={(event) => {
                  inputRef.current = event.target.value;
                  setInput(event.target.value);
                }}
                placeholder={mobilePlaceholder}
                className="min-h-14 w-full min-w-0 rounded-xl border border-cyan-400/35 bg-[#071e36] py-3 pl-4 pr-14 text-base text-white placeholder-blue-200/45 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50"
              />
              <button
                type="button"
                aria-label={
                  listenLang === "es"
                    ? GUEST_STAY_SIMPLE_MOBILE_COPY.dictateMicAriaEs
                    : GUEST_STAY_SIMPLE_MOBILE_COPY.dictateMicAriaEn
                }
                onClick={onDictateMicHintClick}
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-cyan-100 outline-none hover:bg-cyan-400/15 focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <Mic className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {mobileMicHintVisible ? (
              <p
                role="status"
                className="mt-2 rounded-lg border border-cyan-400/25 bg-[#082238] px-3 py-2 text-xs leading-snug text-cyan-50"
              >
                {listenLang === "es"
                  ? GUEST_STAY_SIMPLE_MOBILE_COPY.dictateMicHintEs
                  : GUEST_STAY_SIMPLE_MOBILE_COPY.dictateMicHintEn}
              </p>
            ) : null}
          </div>
        ) : (
          <input
            id="guest-elena-message"
            type="text"
            name="message"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={500}
            value={input}
            onChange={(event) => {
              inputRef.current = event.target.value;
              setInput(event.target.value);
            }}
            placeholder={`${GUEST_ELENA_TEXT_COPY.placeholderEn} / ${GUEST_ELENA_TEXT_COPY.placeholderEs}`}
            className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-cyan-400/30 bg-[#071e36] px-3 py-2 text-sm text-white placeholder-blue-200/45 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50"
          />
        )}
        <button
          type="submit"
          disabled={!canStartGuestStayChatSend({ sending, message: input })}
          className={
            simpleMobileUi
              ? "min-h-12 w-full rounded-xl bg-cyan-400 px-4 py-3 text-base font-semibold text-[#062033] hover:bg-cyan-300 disabled:pointer-events-none disabled:opacity-40"
              : "min-h-11 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#062033] hover:bg-cyan-300 disabled:pointer-events-none disabled:opacity-40"
          }
        >
          {sending
            ? simpleMobileUi
              ? listenLang === "es"
                ? GUEST_ELENA_TEXT_COPY.sendingEs
                : GUEST_ELENA_TEXT_COPY.sendingEn
              : `${GUEST_ELENA_TEXT_COPY.sendingEn} / ${GUEST_ELENA_TEXT_COPY.sendingEs}`
            : simpleMobileUi
              ? listenLang === "es"
                ? GUEST_ELENA_TEXT_COPY.sendEs
                : GUEST_ELENA_TEXT_COPY.sendEn
              : `${GUEST_ELENA_TEXT_COPY.sendEn} / ${GUEST_ELENA_TEXT_COPY.sendEs}`}
        </button>
      </form>

      {showMobileServerStt ? welcomeControls : null}

      {error ? (
        <div className="mt-3">
          <p className="text-sm text-amber-200">{GUEST_ELENA_TEXT_COPY.errorEn}</p>
          <p className="text-sm text-cyan-200/90">{GUEST_ELENA_TEXT_COPY.errorEs}</p>
          {retryMessage ? (
            <button
              type="button"
              disabled={sending}
              onClick={() => void send(retryMessage)}
              className="mt-2 min-h-11 rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/10 disabled:opacity-40"
            >
              {GUEST_ELENA_TEXT_COPY.retryEn} / {GUEST_ELENA_TEXT_COPY.retryEs}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
