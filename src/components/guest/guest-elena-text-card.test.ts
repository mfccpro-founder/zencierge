import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendGuestStayChatMessageIfCurrent,
  canStartGuestStayChatSend,
  createGuestStayChatLifecycle,
  guestStayChatClearedUi,
  guestStayChatMessagesForDisplay,
  guestStayChatRequestBody,
  guestStayHasSpeakableAssistantReply,
  guestStayManualListenAllowed,
  guestStayFinishServerVoiceLoading,
  guestStayFinishReplyVoiceLoading,
  guestStayIsCurrentReplyVoice,
  guestStayShouldScheduleListenRearm,
  guestStayShouldStartBrowserFallback,
  guestStayShouldStartListenRearm,
  guestStayIsIosUserAgent,
  guestStayPostSpeechListenRearmEnabled,
  guestStaySimpleMobileQuickActionLabel,
  guestStaySimpleMobileQuickActionMessage,
  guestStaySimpleMobileDictateCollapsed,
  guestStaySimpleMobileUiPreferred,
  guestStayVoiceControlMode,
  GUEST_ELENA_TEXT_COPY,
  GUEST_STAY_GREETING_BUBBLE_ID,
  GUEST_STAY_POST_SPEECH_REARM_MS,
  GUEST_STAY_SIMPLE_MOBILE_COPY,
  GUEST_STAY_SIMPLE_MOBILE_QUICK_ACTIONS,
  GUEST_STAY_SPANISH_POST_TTS_SETTLE_MS,
  guestStayPostSpeechRearmDelayMs,
  GUEST_STAY_WELCOME_COPY,
  guestStayTapBlockedByWelcome,
  guestStayWelcomeControlMode,
  guestStayWelcomeRequestBody,
  initialGuestStayChatTranscript,
  restoreGuestStayChatInput,
  swallowGuestStayChatCleanup,
  visibleGuestStayChatMessages,
} from "./guest-elena-text-card";
import { detectGuestStayChatIntent } from "@/lib/guest-stay-chat";
import { GUEST_STAY_LISTEN_COPY } from "@/lib/guest-stay-listen";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function mustStart(value: { generation: number; message: string } | null, message: string) {
  if (!value) throw new Error(message);
  return value;
}

export function runGuestElenaTextCardTests() {
  const life = createGuestStayChatLifecycle();
  const started = mustStart(life.beginSend("Hello"), "first send starts");
  assert(life.snapshot().sending, "send marks in-flight");
  const done = life.finish(started.generation, "success", "Check-in is listed on the stay card.");
  assert(!done.sending, "200 completion re-enables Send");
  assert(done.error === false, "200 completion has no error");
  assert(done.messages.some((bubble) => bubble.role === "elena" && bubble.text.includes("Check-in")), "200 appends reply");

  const first = createGuestStayChatLifecycle();
  const firstSend = mustStart(first.beginSend("Hello"), "first card can send");
  const writesBeforeUnmount = first.snapshot().stateWrites;
  first.unmount();
  first.finish(firstSend.generation, "success", "stale reply");
  assert(first.snapshot().stateWrites === writesBeforeUnmount, "unmount abort performs no post-unmount state update");
  assert(!first.snapshot().mounted, "unmounted flag is set");
  const second = createGuestStayChatLifecycle();
  second.remount();
  assert(!second.snapshot().sending, "200 followed by remount starts a new card unlocked");
  assert(canStartGuestStayChatSend({ sending: second.snapshot().sending, message: "Hi" }), "new card Send is enabled");

  const abortMounted = createGuestStayChatLifecycle();
  const abortSend = mustStart(abortMounted.beginSend("Hello"), "abort case starts");
  const aborted = abortMounted.finish(abortSend.generation, "abort");
  assert(!aborted.sending, "abort while still mounted re-enables Send");
  assert(aborted.error === false, "abort does not show a user-facing error");
  assert(aborted.retryMessage === null, "abort does not set retry");

  const dup = createGuestStayChatLifecycle();
  const original = mustStart(dup.beginSend("Hello"), "duplicate case starts");
  const duplicate = dup.beginSend("Hello again");
  assert(duplicate === null, "duplicate send is ignored");
  assert(dup.snapshot().generation === original.generation, "duplicate does not replace the active generation");
  const afterDup = dup.finish(original.generation, "success", "Still the first reply.");
  assert(afterDup.messages.filter((bubble) => bubble.role === "guest").length === 1, "duplicate did not append a second guest message");
  assert(afterDup.messages.some((bubble) => bubble.text.includes("first reply")), "first request still completes");

  const stale = createGuestStayChatLifecycle();
  const older = mustStart(stale.beginSend("First"), "older send starts");
  stale.unmount();
  stale.remount();
  const newer = mustStart(stale.beginSend("Second"), "newer send starts after remount");
  const afterStale = stale.finish(older.generation, "success", "Must not appear.");
  assert(afterStale.sending, "stale completion cannot unlock a newer request");
  assert(!afterStale.messages.some((bubble) => bubble.text.includes("Must not appear")), "stale completion cannot overwrite a newer reply");
  const afterNew = stale.finish(newer.generation, "success", "Newer reply.");
  assert(!afterNew.sending, "newer request can still complete");
  assert(afterNew.messages.some((bubble) => bubble.text.includes("Newer reply")), "newer reply is kept");

  const retry = createGuestStayChatLifecycle();
  const failed = mustStart(retry.beginSend("Hello"), "retry case starts");
  const failedSnap = retry.finish(failed.generation, "failure");
  assert(!failedSnap.sending && failedSnap.error, "network error re-enables Send and shows error");
  assert(failedSnap.retryMessage === "Hello", "retry keeps the failed message");
  const retried = mustStart(retry.beginSend(failedSnap.retryMessage ?? ""), "retry after network error works");
  const retriedOk = retry.finish(retried.generation, "success", "Recovered.");
  assert(!retriedOk.sending && !retriedOk.error, "retry success clears sending and error");

  const listenLife = createGuestStayChatLifecycle();
  listenLife.typeInput("Need");
  const listenGen = listenLife.startListen();
  if (listenGen === null) throw new Error("listen starts");
  assert(listenLife.snapshot().listening, "listen marks listening");
  assert(listenLife.snapshot().ttsAborted >= 1, "Tap to talk aborts in-flight stay-tts");
  assert(listenLife.snapshot().speechCancelled >= 1, "Tap to talk cancels browser speech");
  const speakingTap = createGuestStayChatLifecycle();
  const speakingGen = speakingTap.startListen();
  if (speakingGen === null) throw new Error("speaking tap starts");
  assert(speakingTap.snapshot().speechCancelled >= 1, "Tap to talk cancels speech before recognition");
  const heard = listenLife.finishListen(listenGen, "checkout time");
  assert(!heard.listening, "one final phrase ends listening");
  assert(heard.sending, "first final phrase auto-sends through the shared Send lifecycle");
  assert(heard.input === "", "auto-send does not wait on setInput");
  assert(heard.messages.some((bubble) => bubble.role === "guest" && bubble.text === "Need checkout time"), "draft plus recognized phrase is sent once");
  const duplicateHear = listenLife.finishListen(listenGen, "checkout time");
  assert(duplicateHear.messages.filter((bubble) => bubble.role === "guest").length === 1, "the same listen generation cannot send twice");
  listenLife.finish(heard.generation, "success", "Check-in is listed.");
  listenLife.typeInput("a".repeat(498));
  const capGen = listenLife.startListen();
  if (capGen === null) throw new Error("cap listen starts");
  const capped = listenLife.finishListen(capGen, "hello");
  assert(capped.messages.some((bubble) => bubble.role === "guest" && bubble.text.length === 500), "recognized text is capped at 500");

  const emptyListen = createGuestStayChatLifecycle();
  const emptyGen = emptyListen.startListen();
  if (emptyGen === null) throw new Error("empty listen starts");
  const emptyHeard = emptyListen.finishListen(emptyGen, "   ");
  assert(!emptyHeard.sending && emptyHeard.messages.length === 1, "empty recognized text is not sent");

  const overlap = createGuestStayChatLifecycle();
  mustStart(overlap.beginSend("Hello"), "text send starts");
  overlap.typeInput("Draft");
  const overlapGen = overlap.startListen();
  if (overlapGen === null) throw new Error("overlap listen starts");
  const overlapHeard = overlap.finishListen(overlapGen, "voice");
  assert(overlapHeard.sending, "in-flight text send still blocks voice send");
  assert(overlapHeard.input === "Draft voice", "blocked voice-send keeps the combined draft in the input");
  assert(overlapHeard.messages.filter((bubble) => bubble.role === "guest").length === 1, "voice does not start a second send");

  const voiceFail = createGuestStayChatLifecycle();
  const voiceGen = voiceFail.startListen();
  if (voiceGen === null) throw new Error("voice fail listen starts");
  const voiceStarted = voiceFail.finishListen(voiceGen, "Where is checkout");
  assert(voiceStarted.sending, "voice send starts");
  voiceFail.typeInput("Newer draft");
  const voiceFailed = voiceFail.finish(voiceStarted.generation, "failure");
  assert(voiceFailed.input === "Newer draft", "failed voice-send preserves newer typing");
  const voiceFailEmpty = createGuestStayChatLifecycle();
  const voiceFailGen = voiceFailEmpty.startListen();
  if (voiceFailGen === null) throw new Error("voice fail empty starts");
  const voiceEmptyStarted = voiceFailEmpty.finishListen(voiceFailGen, "Where is checkout");
  const voiceEmptyFailed = voiceFailEmpty.finish(voiceEmptyStarted.generation, "failure");
  assert(voiceEmptyFailed.input === "Where is checkout", "failed voice-send restores the spoken question when input is still empty");

  const stopListen = createGuestStayChatLifecycle();
  const stopGen = stopListen.startListen();
  if (stopGen === null) throw new Error("stop listen starts");
  stopListen.stopListen();
  assert(!stopListen.snapshot().listening, "Stop aborts listening");
  assert(stopListen.finishListen(stopGen, "stale").input === "", "stale listen result after Stop is ignored");

  const sendAbortsMic = createGuestStayChatLifecycle();
  const micGen = sendAbortsMic.startListen();
  if (micGen === null) throw new Error("send abort listen starts");
  sendAbortsMic.typeInput("Hello");
  mustStart(sendAbortsMic.beginSend("Hello"), "send aborts mic");
  assert(!sendAbortsMic.snapshot().listening, "Send aborts recognition");
  assert(sendAbortsMic.finishListen(micGen, "should not apply").input === "", "stale mic result cannot fill after Send");

  const unmountMic = createGuestStayChatLifecycle();
  const unmountMicGen = unmountMic.startListen();
  if (unmountMicGen === null) throw new Error("unmount mic starts");
  unmountMic.unmount();
  assert(unmountMic.finishListen(unmountMicGen, "stale").input === "", "unmount/token remount abort listen safely");

  const remountMic = createGuestStayChatLifecycle();
  const oldMic = remountMic.startListen();
  if (oldMic === null) throw new Error("old mic starts");
  remountMic.unmount();
  remountMic.remount();
  assert(remountMic.finishListen(oldMic, "stale").input === "", "stale listen after remount is ignored");

  const clearLife = createGuestStayChatLifecycle();
  const clearSend = mustStart(clearLife.beginSend("Hello"), "clear after send");
  clearLife.finish(clearSend.generation, "success", "Check-in is listed on the stay card.");
  clearLife.typeInput("Draft");
  clearLife.startListen();
  const beforeClear = clearLife.snapshot();
  assert(beforeClear.messages.length >= 2, "conversation exists before Clear");
  const cleared = clearLife.clearChat();
  const greeting = initialGuestStayChatTranscript();
  const ui = guestStayChatClearedUi();
  assert(cleared.input === ui.input, "Clear chat clears input");
  assert(!cleared.sending && !cleared.listening && !cleared.error, "Clear chat resets sending/listening/error");
  assert(cleared.messages.length === 1, "Clear leaves exactly one greeting bubble");
  assert(cleared.messages[0]?.id === greeting[0]?.id, "Clear restores the greeting id");
  assert(
    cleared.messages[0]?.text === greeting[0]?.text &&
      cleared.messages[0]?.text.includes(GUEST_ELENA_TEXT_COPY.greetingEn) &&
      cleared.messages[0]?.text.includes(GUEST_ELENA_TEXT_COPY.greetingEs),
    "Clear restores the original bilingual greeting",
  );
  assert(cleared.speechCancelled >= 1, "Clear chat cancels TTS");
  assert(cleared.ttsAborted >= 1, "Clear chat aborts stay-tts");
  assert(!cleared.messages.some((bubble) => bubble.text === "Hello"), "visible transcript is cleared");
  const afterClear = clearLife.finish(clearSend.generation, "success", "Must not reappear.");
  assert(!afterClear.messages.some((bubble) => bubble.text.includes("Must not reappear")), "stale chat completion cannot reappear after Clear chat");
  assert(afterClear.messages.length === 1, "stale completion cannot grow the transcript");
  assert(afterClear.messages[0]?.text.includes("conserjería segura"), "greeting remains after stale completion");

  const throwClear = createGuestStayChatLifecycle();
  const throwSend = mustStart(throwClear.beginSend("Hello"), "throwing cancel starts");
  throwClear.finish(throwSend.generation, "success", "Check-in is listed on the stay card.");
  throwClear.clearChat();
  let cancelled = false;
  swallowGuestStayChatCleanup(() => {
    cancelled = true;
    throw new Error("speechSynthesis.cancel failed");
  });
  assert(cancelled, "cleanup still runs");
  assert(throwClear.snapshot().messages.length === 1, "thrown cancel cannot reverse the cleared transcript");
  assert(throwClear.snapshot().messages[0]?.text === greeting[0]?.text, "greeting survives thrown cancel");

  assert(
    appendGuestStayChatMessageIfCurrent({
      current: greeting,
      next: { id: "elena-stale", role: "elena", text: "Must not reappear." },
      isCurrent: false,
    }).length === 1,
    "stale functional updater keeps the greeting-only transcript",
  );

  const successClear = createGuestStayChatLifecycle();
  assert(successClear.beginSend("   ") === null, "empty send is blocked");
  const successSend = mustStart(successClear.beginSend("Hello"), "success clear starts");
  assert(successClear.snapshot().input === "", "valid send clears input immediately");
  const successDone = successClear.finish(successSend.generation, "success", "Check-in is listed.");
  assert(successDone.input === "", "success keeps the input empty");

  const failRestore = createGuestStayChatLifecycle();
  const failSend = mustStart(failRestore.beginSend("Hello"), "failure restore starts");
  const failDone = failRestore.finish(failSend.generation, "failure");
  assert(failDone.input === "Hello", "failure restores the original message when the input is still empty");

  const typed = createGuestStayChatLifecycle();
  const typedSend = mustStart(typed.beginSend("Hello"), "newer typing starts");
  typed.typeInput("Newer draft");
  const typedFail = typed.finish(typedSend.generation, "failure");
  assert(typedFail.input === "Newer draft", "failure does not overwrite newer typing");

  assert(
    restoreGuestStayChatInput({
      mounted: true,
      isCurrentGeneration: true,
      currentInput: "",
      originalMessage: "Hello",
    }) === "Hello",
    "restore helper fills an empty current input",
  );
  assert(
    restoreGuestStayChatInput({
      mounted: true,
      isCurrentGeneration: true,
      currentInput: "Newer draft",
      originalMessage: "Hello",
    }) === "Newer draft",
    "restore helper preserves newer typing",
  );
  assert(
    restoreGuestStayChatInput({
      mounted: false,
      isCurrentGeneration: true,
      currentInput: "",
      originalMessage: "Hello",
    }) === "",
    "restore helper does not write after unmount",
  );
  assert(
    restoreGuestStayChatInput({
      mounted: true,
      isCurrentGeneration: false,
      currentInput: "",
      originalMessage: "Hello",
    }) === "",
    "restore helper does not write for a stale generation",
  );

  const sendTts = createGuestStayChatLifecycle();
  mustStart(sendTts.beginSend("Hello"), "send aborts prior stay-tts");
  assert(sendTts.snapshot().ttsAborted >= 1, "new Send aborts stay-tts");
  sendTts.unmount();
  assert(sendTts.snapshot().ttsAborted >= 2, "unmount aborts stay-tts");
  const remountTts = createGuestStayChatLifecycle();
  remountTts.unmount();
  remountTts.remount();
  assert(remountTts.snapshot().ttsAborted >= 2, "token remount aborts stay-tts");

  assert(visibleGuestStayChatMessages([1, 2, 3, 4, 5, 6, 7, 8, 9]).length === 8, "visible cap remains eight");
  const greetingOnly = initialGuestStayChatTranscript();
  assert(!guestStayHasSpeakableAssistantReply(greetingOnly), "greeting only has no voice control");
  assert(guestStayVoiceControlMode({ messages: greetingOnly, speechStatus: "idle" }) === "hidden", "greeting only hides Listen");
  const greetingAndGuest = [
    ...greetingOnly,
    { id: "guest-1", role: "guest" as const, text: "When is checkout?" },
  ];
  assert(!guestStayHasSpeakableAssistantReply(greetingAndGuest), "guest bubble alone does not show voice control");
  const withElenaReply = [
    ...greetingAndGuest,
    { id: "elena-2", role: "elena" as const, text: "Checkout is listed on the stay card." },
  ];
  assert(guestStayHasSpeakableAssistantReply(withElenaReply), "a new Elena reply enables voice control");
  assert(guestStayVoiceControlMode({ messages: withElenaReply, speechStatus: "idle" }) === "listen", "idle policy reply shows Listen");
  assert(guestStayVoiceControlMode({ messages: withElenaReply, speechStatus: "speaking" }) === "stop", "speaking policy reply shows Stop");
  assert(guestStayVoiceControlMode({ messages: withElenaReply, speechStatus: "stopped" }) === "listen", "stopped shows Listen");
  assert(guestStayVoiceControlMode({ messages: withElenaReply, speechStatus: "unavailable" }) === "listen", "unavailable shows Listen");
  assert(
    guestStayVoiceControlMode({ messages: withElenaReply, speechStatus: "idle", serverVoiceLoading: true }) === "preparing",
    "loading shows Preparing Elena voice",
  );
  assert(!guestStayManualListenAllowed(true), "Listen is blocked while TTS is loading");
  assert(guestStayManualListenAllowed(false), "Listen is allowed after TTS settles");
  assert(
    !guestStayShouldStartBrowserFallback({ finishLoading: true, wasLoading: true, outcome: "playing" }),
    "successful MP3 does not start browser speech",
  );
  assert(
    !guestStayShouldStartBrowserFallback({ finishLoading: true, wasLoading: true, outcome: "retained" }),
    "retained autoplay does not start browser speech",
  );
  assert(
    guestStayShouldStartBrowserFallback({ finishLoading: true, wasLoading: true, outcome: "failed" }),
    "provider failure starts browser speech once loading clears",
  );
  assert(
    !guestStayShouldStartBrowserFallback({ finishLoading: true, wasLoading: false, outcome: "failed" }),
    "a second failure does not start browser speech again",
  );
  assert(
    !guestStayFinishServerVoiceLoading({ mounted: true, ownerGeneration: 1, currentGeneration: 2, superseded: false }),
    "stale TTS does not clear a newer generation",
  );
  assert(
    !guestStayFinishServerVoiceLoading({ mounted: true, ownerGeneration: 2, currentGeneration: 2, superseded: true }),
    "superseded abort does not clear the in-flight loading flag",
  );
  const clearedUi = guestStayChatClearedUi();
  assert(clearedUi.messages.length === 1 && clearedUi.messages[0]?.id === GUEST_STAY_GREETING_BUBBLE_ID, "Clear restores greeting only");
  assert(!guestStayHasSpeakableAssistantReply(clearedUi.messages), "Clear hides the voice control");
  assert(!("hasAssistantReply" in clearedUi), "cleared UI has no separate assistant boolean");
  const replyLife = createGuestStayChatLifecycle();
  const replySend = mustStart(replyLife.beginSend("When is checkout?"), "policy send starts");
  const afterGuest = replyLife.snapshot();
  assert(!guestStayHasSpeakableAssistantReply(afterGuest.messages), "guest bubble before Elena reply hides Listen");
  const afterReply = replyLife.finish(replySend.generation, "success", "Checkout is listed on the stay card.");
  assert(guestStayHasSpeakableAssistantReply(afterReply.messages), "lifecycle Elena reply enables Listen");
  assert(guestStayVoiceControlMode({ messages: afterReply.messages, speechStatus: "idle" }) === "listen", "retained-autoplay idle shows Listen");
  const loadingLife = createGuestStayChatLifecycle();
  const loadingSend = mustStart(loadingLife.beginSend("When is checkout?"), "loading send starts");
  const loadingReply = loadingLife.finish(loadingSend.generation, "success", "Checkout is listed on the stay card.");
  assert(guestStayHasSpeakableAssistantReply(loadingReply.messages), "reply appears while TTS is loading");
  loadingLife.beginStayAudio(loadingSend.generation);
  const loadingSnap = loadingLife.snapshot();
  assert(loadingSnap.serverVoiceLoading, "stay-tts in flight marks server voice loading");
  assert(
    guestStayVoiceControlMode({
      messages: loadingSnap.messages,
      speechStatus: "idle",
      serverVoiceLoading: loadingSnap.serverVoiceLoading,
    }) === "preparing",
    "loading shows disabled Preparing Elena voice control",
  );
  loadingLife.attemptManualListen();
  assert(loadingLife.snapshot().manualListenBlocked >= 1, "clicking Listen during loading does nothing");
  assert(loadingLife.snapshot().browserSpeechStarts === 0, "no browser speech starts while TTS fetch is in flight");
  const playingSnap = loadingLife.finishStayAudio(loadingSend.generation, "playing");
  assert(!playingSnap.serverVoiceLoading, "successful autoplay clears loading");
  assert(
    guestStayVoiceControlMode({
      messages: playingSnap.messages,
      speechStatus: "speaking",
      serverVoiceLoading: playingSnap.serverVoiceLoading,
    }) === "stop",
    "successful autoplay changes Preparing to Stop",
  );
  assert(playingSnap.browserSpeechStarts === 0, "server MP3 arrival cannot overlap browser speech");
  assert(playingSnap.speechCancelled >= 1, "successful autoplay cancels browser speech if it was speaking");

  const retainedLife = createGuestStayChatLifecycle();
  const retainedSend = mustStart(retainedLife.beginSend("When is checkout?"), "retained send starts");
  retainedLife.finish(retainedSend.generation, "success", "Checkout is listed on the stay card.");
  retainedLife.beginStayAudio(retainedSend.generation);
  const retainedSnap = retainedLife.finishStayAudio(retainedSend.generation, "retained");
  assert(!retainedSnap.serverVoiceLoading, "retained autoplay clears loading");
  assert(
    guestStayVoiceControlMode({
      messages: retainedSnap.messages,
      speechStatus: "idle",
      serverVoiceLoading: retainedSnap.serverVoiceLoading,
    }) === "listen",
    "retained autoplay changes Preparing to Listen",
  );
  assert(retainedSnap.browserSpeechStarts === 0, "retained autoplay does not start browser speech");

  const failLife = createGuestStayChatLifecycle();
  const failVoice = mustStart(failLife.beginSend("When is checkout?"), "failure send starts");
  failLife.finish(failVoice.generation, "success", "Checkout is listed on the stay card.");
  failLife.beginStayAudio(failVoice.generation);
  failLife.finishStayAudio(failVoice.generation, "failed");
  failLife.finishStayAudio(failVoice.generation, "failed");
  assert(failLife.snapshot().browserSpeechStarts === 1, "provider failure invokes browser fallback exactly once");
  assert(!failLife.snapshot().serverVoiceLoading, "provider failure clears loading");
  assert(
    failLife.snapshot().messages.some((item) => item.role === "elena" && item.text === "Checkout is listed on the stay card."),
    "written Elena reply remains after audio failure",
  );

  const staleLife = createGuestStayChatLifecycle();
  const staleSend = mustStart(staleLife.beginSend("When is checkout?"), "stale send starts");
  staleLife.finish(staleSend.generation, "success", "Checkout is listed on the stay card.");
  staleLife.beginStayAudio(staleSend.generation);
  staleLife.beginSend("Another question");
  const staleDone = staleLife.finishStayAudio(staleSend.generation, "stale");
  assert(!staleDone.serverVoiceLoading, "new Send clears loading");
  assert(staleDone.browserSpeechStarts === 0, "stale TTS does not start browser speech");

  const abortLife = createGuestStayChatLifecycle();
  const abortVoice = mustStart(abortLife.beginSend("When is checkout?"), "abort send starts");
  abortLife.finish(abortVoice.generation, "success", "Checkout is listed on the stay card.");
  abortLife.beginStayAudio(abortVoice.generation);
  abortLife.beginStayAudio(abortVoice.generation);
  const superseded = abortLife.finishStayAudio(abortVoice.generation, "aborted", 1);
  assert(superseded.serverVoiceLoading, "superseded abort leaves current loading");
  assert(superseded.browserSpeechStarts === 0, "superseded abort does not start browser speech");
  assert(!abortLife.finishStayAudio(abortVoice.generation, "playing").serverVoiceLoading, "current request can still finish");

  const clearLoad = createGuestStayChatLifecycle();
  const clearVoice = mustStart(clearLoad.beginSend("When is checkout?"), "clear loading send starts");
  clearLoad.finish(clearVoice.generation, "success", "Checkout is listed on the stay card.");
  clearLoad.beginStayAudio(clearVoice.generation);
  const clearedLoad = clearLoad.clearChat();
  assert(!clearedLoad.serverVoiceLoading, "Clear chat clears loading");
  assert(!guestStayHasSpeakableAssistantReply(clearedLoad.messages), "Clear hides the voice control");
  assert(clearedLoad.browserSpeechStarts === 0, "Clear does not start browser speech");

  const unmountLoad = createGuestStayChatLifecycle();
  const unmountSend = mustStart(unmountLoad.beginSend("When is checkout?"), "unmount loading send starts");
  unmountLoad.finish(unmountSend.generation, "success", "Checkout is listed on the stay card.");
  unmountLoad.beginStayAudio(unmountSend.generation);
  const unmounted = unmountLoad.unmount();
  assert(!unmounted.serverVoiceLoading, "unmount clears loading");
  unmountLoad.finishStayAudio(unmountSend.generation, "playing");
  assert(unmountLoad.snapshot().browserSpeechStarts === 0, "unmount does not apply a stale speaking update");
  unmountLoad.remount();
  assert(!unmountLoad.snapshot().serverVoiceLoading, "token remount leaves loading cleared");

  const welcomeLife = createGuestStayChatLifecycle();
  assert(welcomeLife.snapshot().messages.length === 1, "welcome does not add transcript bubbles on load");
  assert(welcomeLife.snapshot().welcomeRequests === 0, "welcome does not auto-play on page load");
  const beforeWelcome = welcomeLife.snapshot().messages;
  welcomeLife.beginWelcome();
  assert(welcomeLife.snapshot().welcomeLoading, "welcome click marks preparing");
  assert(welcomeLife.snapshot().welcomeRequests === 1, "welcome click requests once");
  assert(welcomeLife.snapshot().listening === false, "welcome aborts microphone recognition");
  const afterWelcome = welcomeLife.finishWelcome("playing");
  assert(afterWelcome.messages.length === beforeWelcome.length, "welcome does not mutate the transcript");
  assert(!afterWelcome.messages.some((bubble) => bubble.role === "guest"), "welcome does not add a guest bubble");
  assert(guestStayTapBlockedByWelcome({ welcomeLoading: true, welcomeSpeaking: false }), "tap is blocked while welcome loads");
  assert(guestStayTapBlockedByWelcome({ welcomeLoading: false, welcomeSpeaking: true }), "tap is blocked while welcome speaks");
  const blockedTap = createGuestStayChatLifecycle();
  blockedTap.beginWelcome();
  assert(blockedTap.startListen() === null, "welcome and microphone cannot overlap");
  blockedTap.finishWelcome("playing");
  assert(blockedTap.startListen() === null, "tap stays blocked while welcome is speaking");
  blockedTap.stopWelcome();
  const afterStop = blockedTap.startListen();
  assert(afterStop !== null, "tap can start after welcome stops");

  const welcomeLang = createGuestStayChatLifecycle();
  welcomeLang.beginWelcome();
  welcomeLang.changeLang();
  assert(!welcomeLang.snapshot().welcomeLoading && !welcomeLang.snapshot().welcomeSpeaking, "language change stops old welcome");

  const welcomeSend = createGuestStayChatLifecycle();
  welcomeSend.beginWelcome();
  welcomeSend.beginSend("When is checkout?");
  assert(!welcomeSend.snapshot().welcomeLoading, "Send stops welcome audio");

  const welcomeClear = createGuestStayChatLifecycle();
  welcomeClear.beginWelcome();
  welcomeClear.clearChat();
  assert(!welcomeClear.snapshot().welcomeLoading, "Clear revokes welcome audio");

  const welcomeUnmount = createGuestStayChatLifecycle();
  welcomeUnmount.beginWelcome();
  welcomeUnmount.unmount();
  assert(!welcomeUnmount.snapshot().welcomeLoading, "unmount revokes welcome audio");

  const welcomeFail = createGuestStayChatLifecycle();
  welcomeFail.beginWelcome();
  welcomeFail.finishWelcome("failed");
  welcomeFail.finishWelcome("failed");
  assert(welcomeFail.snapshot().welcomeFallbackStarts === 1, "welcome browser fallback is at most once");

  assert(
    guestStayIsCurrentReplyVoice({ mounted: true, chatOwner: 2, chatCurrent: 2, replyOwner: 4, replyCurrent: 4 }),
    "current chat and reply voice generations may play",
  );
  assert(
    !guestStayIsCurrentReplyVoice({ mounted: true, chatOwner: 2, chatCurrent: 2, replyOwner: 3, replyCurrent: 4 }),
    "stale reply voice generation cannot play",
  );
  assert(
    !guestStayFinishReplyVoiceLoading({
      mounted: true,
      chatOwner: 2,
      chatCurrent: 2,
      replyOwner: 3,
      replyCurrent: 4,
      superseded: false,
    }),
    "stale reply completion cannot clear a newer loading state",
  );

  const welcomeOverReplyFetch = createGuestStayChatLifecycle();
  const welcomeOverSend = mustStart(welcomeOverReplyFetch.beginSend("When is checkout?"), "welcome-over-reply send starts");
  welcomeOverReplyFetch.finish(welcomeOverSend.generation, "success", "Checkout is listed on the stay card.");
  welcomeOverReplyFetch.beginStayAudio(welcomeOverSend.generation);
  const replyGenBeforeWelcome = welcomeOverReplyFetch.snapshot().replyVoiceGeneration;
  welcomeOverReplyFetch.beginWelcome();
  assert(welcomeOverReplyFetch.snapshot().replyVoiceGeneration > replyGenBeforeWelcome, "welcome start invalidates in-flight reply voice");
  assert(!welcomeOverReplyFetch.snapshot().serverVoiceLoading, "welcome start clears reply loading");
  const lateReplyPlay = welcomeOverReplyFetch.finishStayAudio(welcomeOverSend.generation, "playing");
  assert(lateReplyPlay.staleReplyCompletions >= 1, "late reply completion is ignored after welcome starts");
  assert(lateReplyPlay.welcomeLoading, "welcome loading survives a stale reply completion");
  assert(lateReplyPlay.browserSpeechStarts === 0, "late reply cannot start fallback speech during welcome");

  const welcomeOverReplyPlay = createGuestStayChatLifecycle();
  const welcomeOverPlaySend = mustStart(welcomeOverReplyPlay.beginSend("When is checkout?"), "welcome-over-playing send starts");
  welcomeOverReplyPlay.finish(welcomeOverPlaySend.generation, "success", "Checkout is listed on the stay card.");
  welcomeOverReplyPlay.beginStayAudio(welcomeOverPlaySend.generation);
  welcomeOverReplyPlay.finishStayAudio(welcomeOverPlaySend.generation, "playing");
  const replyGenWhilePlaying = welcomeOverReplyPlay.snapshot().replyVoiceGeneration;
  welcomeOverReplyPlay.beginWelcome();
  assert(welcomeOverReplyPlay.snapshot().replyVoiceGeneration > replyGenWhilePlaying, "welcome start bumps reply voice before welcome fetch");
  const stalePlayingReply = welcomeOverReplyPlay.finishStayAudio(welcomeOverPlaySend.generation, "playing");
  assert(stalePlayingReply.staleReplyCompletions >= 1, "stale reply onended cannot affect welcome");
  assert(stalePlayingReply.welcomeLoading, "welcome loading is unchanged by stale reply onended");

  const replyOverWelcomeFetch = createGuestStayChatLifecycle();
  const replyOverSend = mustStart(replyOverWelcomeFetch.beginSend("When is checkout?"), "reply-over-welcome send starts");
  replyOverWelcomeFetch.finish(replyOverSend.generation, "success", "Checkout is listed on the stay card.");
  const messagesBeforeReplyWelcome = replyOverWelcomeFetch.snapshot().messages;
  replyOverWelcomeFetch.beginWelcome();
  const welcomeGenBeforeReply = replyOverWelcomeFetch.snapshot().welcomeGeneration;
  replyOverWelcomeFetch.beginStayAudio(replyOverSend.generation);
  assert(replyOverWelcomeFetch.snapshot().welcomeGeneration > welcomeGenBeforeReply, "reply TTS aborts pending welcome");
  assert(!replyOverWelcomeFetch.snapshot().welcomeLoading && !replyOverWelcomeFetch.snapshot().welcomeSpeaking, "welcome is stopped before reply TTS");
  const staleWelcomePlay = replyOverWelcomeFetch.finishWelcome("playing");
  assert(staleWelcomePlay.staleWelcomeCompletions >= 1, "stale welcome completion cannot affect reply");
  assert(staleWelcomePlay.serverVoiceLoading, "reply loading survives a stale welcome completion");
  assert(staleWelcomePlay.messages.length === messagesBeforeReplyWelcome.length, "welcome does not mutate transcript");
  assert(staleWelcomePlay.welcomeFallbackStarts === 0, "stale welcome cannot start browser speech during reply");

  const replyOverWelcomePlay = createGuestStayChatLifecycle();
  const replyOverPlaySend = mustStart(replyOverWelcomePlay.beginSend("When is checkout?"), "reply-over-welcome-playing send starts");
  replyOverWelcomePlay.finish(replyOverPlaySend.generation, "success", "Checkout is listed on the stay card.");
  replyOverWelcomePlay.beginWelcome();
  replyOverWelcomePlay.finishWelcome("playing");
  replyOverWelcomePlay.beginStayAudio(replyOverPlaySend.generation);
  assert(!replyOverWelcomePlay.snapshot().welcomeSpeaking, "welcome stops before reply TTS starts");
  const staleWelcomeEnded = replyOverWelcomePlay.finishWelcome("playing");
  assert(staleWelcomeEnded.staleWelcomeCompletions >= 1, "stale welcome onended cannot affect reply");
  assert(staleWelcomeEnded.serverVoiceLoading, "reply loading is unchanged by stale welcome onended");

  const listenEndsWelcome = createGuestStayChatLifecycle();
  const listenWelcomeSend = mustStart(listenEndsWelcome.beginSend("When is checkout?"), "listen-during-welcome send starts");
  listenEndsWelcome.finish(listenWelcomeSend.generation, "success", "Checkout is listed on the stay card.");
  listenEndsWelcome.beginStayAudio(listenWelcomeSend.generation);
  listenEndsWelcome.finishStayAudio(listenWelcomeSend.generation, "retained");
  listenEndsWelcome.beginWelcome();
  listenEndsWelcome.finishWelcome("playing");
  listenEndsWelcome.attemptManualListen();
  assert(!listenEndsWelcome.snapshot().welcomeLoading && !listenEndsWelcome.snapshot().welcomeSpeaking, "Listen ends welcome before the reply clip starts");
  assert(listenEndsWelcome.snapshot().manualListenBlocked === 0, "Listen may start after welcome is halted");

  const stopBoth = createGuestStayChatLifecycle();
  const stopBothSend = mustStart(stopBoth.beginSend("When is checkout?"), "stop-both send starts");
  stopBoth.finish(stopBothSend.generation, "success", "Checkout is listed on the stay card.");
  stopBoth.beginStayAudio(stopBothSend.generation);
  stopBoth.beginWelcome();
  stopBoth.stopVoice();
  assert(stopBoth.snapshot().bothVoicesStopped >= 1, "Stop voice records a dual-path stop");
  assert(!stopBoth.snapshot().welcomeLoading && !stopBoth.snapshot().welcomeSpeaking, "Stop voice stops welcome");
  assert(!stopBoth.snapshot().serverVoiceLoading, "Stop voice stops reply TTS loading");

  const exclusiveSpeech = createGuestStayChatLifecycle();
  const exclusiveSend = mustStart(exclusiveSpeech.beginSend("When is checkout?"), "exclusive speech send starts");
  exclusiveSpeech.finish(exclusiveSend.generation, "success", "Checkout is listed on the stay card.");
  exclusiveSpeech.beginStayAudio(exclusiveSend.generation);
  exclusiveSpeech.finishStayAudio(exclusiveSend.generation, "failed");
  assert(exclusiveSpeech.snapshot().browserSpeechStarts === 1, "failed reply may start browser speech once");
  exclusiveSpeech.beginWelcome();
  exclusiveSpeech.finishStayAudio(exclusiveSend.generation, "failed");
  assert(exclusiveSpeech.snapshot().browserSpeechStarts === 1, "stale reply fallback cannot start speech after welcome");
  exclusiveSpeech.finishWelcome("failed");
  exclusiveSpeech.beginStayAudio(exclusiveSend.generation);
  exclusiveSpeech.finishWelcome("failed");
  assert(exclusiveSpeech.snapshot().welcomeFallbackStarts === 1, "stale welcome fallback cannot start speech after reply");

  const welcomeBody = guestStayWelcomeRequestBody("sample-token", "en");
  assert(Object.keys(welcomeBody).sort().join(",") === "lang,token", "welcome POST is token + lang");
  assert(welcomeBody.lang === "en", "EN click requests lang en");
  assert(guestStayWelcomeRequestBody("sample-token", "es").lang === "es", "ES click requests lang es");
  assert(GUEST_ELENA_TEXT_COPY.greetingEn === GUEST_STAY_WELCOME_COPY.textEn, "visible English greeting equals English welcome TTS source");
  assert(GUEST_ELENA_TEXT_COPY.greetingEs === GUEST_STAY_WELCOME_COPY.textEs, "visible Spanish greeting equals Spanish welcome TTS source");
  assert(GUEST_ELENA_TEXT_COPY.titleEn === "Isabela · Receptionist", "guest title English uses Isabela");
  assert(GUEST_ELENA_TEXT_COPY.titleEs === "Isabela · Recepcionista", "guest title Spanish uses Isabela");
  assert(GUEST_ELENA_TEXT_COPY.preparingVoiceEn.includes("Isabela"), "preparing voice English uses Isabela");
  assert(GUEST_ELENA_TEXT_COPY.preparingVoiceEs.includes("Isabela"), "preparing voice Spanish uses Isabela");
  assert(GUEST_STAY_WELCOME_COPY.textEn === "Hi, I am Isabela, your secure text concierge. Ask about check-in, checkout, stay status, or the service cards below.", "EN speaks only English welcome");
  assert(GUEST_STAY_WELCOME_COPY.textEs === "Hola, soy Isabela, tu conserjería segura por texto. Pregunta por la entrada, la salida, el estado de la estancia o las tarjetas de servicio abajo.", "ES speaks only Spanish welcome");
  assert(!GUEST_STAY_WELCOME_COPY.textEn.includes("Elena") && !GUEST_STAY_WELCOME_COPY.textEs.includes("Elena"), "welcome TTS copy no longer names Elena");
  assert(!GUEST_ELENA_TEXT_COPY.titleEn.includes("Elena") && !GUEST_ELENA_TEXT_COPY.titleEs.includes("Elena"), "titles no longer name Elena");
  assert(guestStayWelcomeControlMode({ loading: false, speaking: false }) === "hear", "idle welcome shows Hear welcome");
  assert(guestStayWelcomeControlMode({ loading: true, speaking: false }) === "preparing", "loading shows Preparing welcome");
  assert(guestStayWelcomeControlMode({ loading: false, speaking: true }) === "stop", "speaking shows Stop welcome");

  const body = guestStayChatRequestBody("sample-token", "Hello");
  assert(Object.keys(body).sort().join(",") === "message,token", "request body remains token + message without preferredLang");
  const bodyPreferred = guestStayChatRequestBody("sample-token", "Hello", "es");
  assert(
    Object.keys(bodyPreferred).sort().join(",") === "message,preferredLang,token" && bodyPreferred.preferredLang === "es",
    "optional preferredLang is included when provided",
  );

  const source = readFileSync(join(process.cwd(), "src/components/guest/guest-elena-text-card.tsx"), "utf8");
  assert(!source.includes("abortRef.current?.abort()") || source.includes("mountedRef.current = false"), "unmount still aborts");
  assert(!/abortRef\.current\?\.abort\(\);\s*const controller/.test(source), "duplicate send does not abort the active request");
  assert(source.includes("guestStayChatRequestBody(token, message, listenLangRef.current)"), "typed chat sends preferredLang from EN/ES toggle");
  assert(
    (source.match(/guestStayChatRequestBody\(token, message, listenLangRef\.current\)/g) ?? []).length === 2,
    "chat and stay-tts use the same token+message+preferredLang helper",
  );
  assert(source.includes('from "@/lib/guest-stay-greeting"'), "Elena card greeting uses the shared frozen copy");
  assert(source.includes("guestStayWelcomeRequestBody(token, lang)"), "welcome token remains only in POST JSON");
  assert(source.includes("GUEST_STAY_AUDIO_PATH"), "successful chat requests stay-tts");
  assert(source.includes("GUEST_STAY_WELCOME_TTS_PATH"), "welcome uses the protected stay-welcome-tts endpoint");
  assert(source.includes("haltWelcome()"), "language change stops welcome audio");
  assert(source.includes("playWelcomeFallback"), "failed welcome can use one browser fallback");
  assert(source.includes("shouldFetchGuestStayAudio"), "stay-tts is gated on a successful current chat");
  assert(source.includes("void requestStayAudio"), "TTS starts after the reply is rendered");
  const stayAudio = source.slice(source.indexOf("const requestStayAudio = async"), source.indexOf("const finishWelcomeLoading"));
  assert(stayAudio.indexOf("haltWelcome()") < stayAudio.indexOf("replyVoiceGenerationRef.current += 1"), "reply TTS halts welcome before a new reply voice generation");
  assert(stayAudio.indexOf("replyVoiceGenerationRef.current += 1") < stayAudio.indexOf("beginServerVoiceLoading"), "reply voice generation is captured before stay-tts work");
  assert(stayAudio.includes("isCurrentReplyVoice"), "stay-tts awaits require current chat and reply voice generations");
  assert(stayAudio.indexOf("beginServerVoiceLoading") < stayAudio.indexOf("await fetch"), "loading is set before stay-tts fetch");
  assert(stayAudio.indexOf("cancelForSend") < stayAudio.indexOf("installAndAutoplay"), "browser speech is cancelled before server autoplay");
  const haltChatSrc = source.slice(source.indexOf("const haltChatVoice = () => {"), source.indexOf("const haltVoice = () => {"));
  assert(haltChatSrc.indexOf("replyVoiceGenerationRef.current += 1") < haltChatSrc.indexOf("abortStayTts"), "haltChatVoice bumps reply voice generation first");
  assert(haltChatSrc.indexOf("abortStayTts") < haltChatSrc.indexOf("resetServerAudio"), "haltChatVoice aborts stay-tts before resetting the reply Audio engine");
  const welcomeRequest = source.slice(source.indexOf("const requestWelcomeAudio = async"), source.indexOf("const onWelcomeButtonClick"));
  assert(welcomeRequest.indexOf("haltChatVoice()") < welcomeRequest.indexOf("welcomeGenRef.current += 1"), "welcome start invalidates reply voice before welcome fetch");
  assert(
    /haltWelcome\(\);\s*if \(welcomeLoadingRef\.current \|\| welcomeSpeakingRef\.current\) return/.test(source),
    "Listen ends welcome and refuses overlap before playing a reply clip",
  );
  assert(/haltWelcome\(\);\s*haltChatVoice\(\);/.test(source), "Stop voice stops welcome and reply paths");
  assert(source.includes("audioElRef") && source.includes("welcomeElRef"), "welcome and reply keep separate Audio elements");
  assert((source.match(/installAndAutoplay/g) ?? []).length >= 2, "welcome and reply each have an install/play path");
  assert(source.includes("guestStayVoiceControlMode"), "Listen/Stop is derived from messages");
  assert(source.includes('voiceControl === "preparing"'), "Preparing Elena voice renders while TTS loads");
  assert(source.includes("preparingVoiceEn"), "Preparing Elena voice copy is shown");
  assert(source.includes("if (serverVoiceLoadingRef.current) return"), "Listen returns immediately while TTS is loading");
  assert(source.includes("if (serverVoiceLoadingRef.current) return") && source.includes("playBrowserFallback"), "browser fallback is gated on loading");
  assert(!/hasAssistantReply|setHasAssistantReply/.test(source), "no separate assistant-reply boolean");
  assert(source.includes('voiceControl !== "hidden"'), "voice controls render from derived mode");
  assert(source.includes('voiceControl === "stop"'), "Stop renders while speaking");
  assert(source.includes("haltVoice()"), "Send/mic abort server audio and browser speech");
  assert(source.includes("playManual"), "Listen prefers cached server audio");
  assert(source.includes("hasUsableClip()"), "Listen checks the cached server MP3 first");
  assert(source.includes("el.currentTime"), "browser audio wrapper exposes currentTime for Listen rewind");
  assert(source.includes("playBrowserFallback"), "failed stay-tts uses gated browser speech");
  const fallbackFn = source.slice(source.indexOf("const playBrowserFallback"), source.indexOf("const requestStayAudio"));
  assert(fallbackFn.indexOf("discard") < fallbackFn.indexOf("cancelForSend"), "fallback pauses/detaches/revokes before cancelling speech");
  assert(fallbackFn.indexOf("cancelForSend") < fallbackFn.indexOf("speakAssistantReply"), "fallback cancels speechSynthesis before browser speech");
  assert(source.includes("speechFallbackGenRef"), "browser speech fallback is at most once per generation");
  assert(source.includes("addEventListener"), "browser Audio exposes metadata events");
  assert(source.includes("el.volume"), "browser Audio wrapper exposes volume");
  assert(source.includes("el.duration"), "browser Audio wrapper exposes duration");
  assert(source.includes('cache: "no-store"'), "stay-chat remains no-store");
  assert(source.includes("guestStayAudioPostInit"), "stay-tts fetch uses the shared no-store helper");
  assert(source.includes("restoreGuestStayChatInput"), "failure restore uses the shared input helper");
  assert(source.includes("setInput((current) =>"), "failure restore reads the current controlled input");
  assert(source.includes("guestStayFinalListenSendText"), "final phrase uses the shared send-text helper");
  assert(source.includes("sendRef.current(message)"), "voice send calls the shared Send function with the captured message");
  assert(source.includes("void send(input)"), "typed form Send remains");
  assert(GUEST_STAY_LISTEN_COPY.privacyEn.includes("sent automatically"), "English mic privacy states auto-send");
  assert(GUEST_STAY_LISTEN_COPY.privacyEs.includes("se envía automáticamente"), "Spanish mic privacy states auto-send");
  assert(source.includes("cancelForSend"), "voice paths still cancel Elena speech");
  assert(!source.includes('status() === "speaking"') || source.includes("haltVoice"), "mic start always stops server and browser voice");
  assert(source.includes("guestStayChatClearedUi"), "session Clear uses the shared reset helper");
  assert(source.includes("swallowGuestStayChatCleanup"), "Clear wraps speech cancel so throws cannot block reset");
  assert(source.includes("appendGuestStayChatMessageIfCurrent"), "reply appends are generation-guarded");
  const clearHandler = source.slice(source.indexOf("const clearChat = () => {"), source.indexOf("const send = async"));
  assert(clearHandler.indexOf("generationRef.current += 1") < clearHandler.indexOf("guestStayChatClearedUi"), "Clear bumps generation before UI reset");
  assert(clearHandler.indexOf("guestStayChatClearedUi") < clearHandler.indexOf("swallowGuestStayChatCleanup"), "Clear resets UI before abort/cancel");
  assert(clearHandler.indexOf("setMessages") < clearHandler.indexOf("unmount"), "setMessages runs before speech unmount");
  assert(!source.includes('method: "DELETE"'), "no API delete method");
  assert(!/localStorage|sessionStorage|console\.(log|info|debug|error)/.test(source), "no persistence or logging");
  assert(source.includes("GUEST_STAY_LISTEN_COPY.privacyEn"), "mic privacy copy is shown");
  assert(source.includes("listenLangRef"), "language selection is stored in a ref");
  assert(source.includes("selectListenLang"), "EN/ES uses an immediate language selector");
  assert(
    /const selectListenLang = \(next: GuestStayListenLang\) => \{[\s\S]*?abortListening\(\);[\s\S]*?clearListenRearmTimer\(\);[\s\S]*?haltChatVoice\(\);[\s\S]*?haltWelcome\(\);/.test(
      source,
    ),
    "R6 language switch aborts listen, clears rearm, and halts voice before welcome halt",
  );
  const selectFn = source.slice(source.indexOf("const selectListenLang"), source.indexOf("const clearChat"));
  assert(selectFn.includes("if (listenLangRef.current === next) return"), "R6 no-ops when language is unchanged");
  assert(!selectFn.includes("startListening(next)"), "R6 does not auto-restart SpeechRecognition on language switch");
  assert(!selectFn.includes("startListeningRef"), "R6 language switch has no automatic listen restart");
  assert(selectFn.includes("pendingReplySpeechRearmRef.current = null"), "R6 clears pending post-TTS rearm on language switch");
  assert(source.includes("onClick={() => startListening()}"), "next voice turn still requires manual Tap");
  assert(/\blang,\s*\n\s*ctor:/.test(source), "recognition start uses the explicit lang argument");
  const formIndex = source.indexOf("<form");
  const tapIndex = source.indexOf("GUEST_STAY_LISTEN_COPY.tapEn");
  assert(tapIndex !== -1 && formIndex !== -1 && tapIndex < formIndex, "Tap to talk stays outside the form");
  assert((source.match(/type="submit"/g) ?? []).length === 1, "Send remains the only submit button");
  assert((source.match(/type="button"/g) ?? []).length >= 6, "non-Send controls remain type=button");
  assert(!source.includes("/api/transcribe"), "Elena card does not upload audio");
  assert(!source.includes('publicApiUrl("/api/tts")') && !source.includes("'/api/tts'"), "Elena card does not call host /api/tts");
  assert(source.includes("GUEST_STAY_AUDIO_PATH") || source.includes("/api/guest/stay-tts"), "Elena card uses stay-tts");
  assert(!source.includes("/api/avatar"), "Elena card does not call avatar");
  assert(!/human-voice|ElenaVoiceWidget|ElenaTalkControls|ElenaGuestIsland|GuestPortal|GuestGate/.test(source), "no unsafe legacy host voice widgets");
  assert(source.includes("@/lib/guest-stay-mobile-stt"), "mobile STT uses isolated guest helper");
  assert(!source.includes("/api/transcribe"), "guest stay does not use host /api/transcribe");
  assert(source.includes("/api/guest/stay-transcribe") || source.includes("postGuestStayMobileTranscribe"), "mobile uses guest stay-transcribe path");
  assert(!/localStorage|sessionStorage|console\.(log|info|debug|error)/.test(source), "no persistence or logging");
  assert(!/DELETE|deleteChat|\/api\/guest\/stay-chat/.test(source.split("guestStayChatRequestBody")[0] ?? "") || source.includes('method: "POST"'), "no API delete");
  assert(!source.includes('method: "DELETE"'), "no API delete method");

  const rearmBase = {
    mounted: true,
    chatOwner: 2,
    chatCurrent: 2,
    replyOwner: 4,
    replyCurrent: 4,
  };
  assert(
    guestStayShouldScheduleListenRearm({ ...rearmBase, alreadyClaimedReplyOwner: null }),
    "TTS end can claim listen rearm once",
  );
  assert(
    guestStayShouldScheduleListenRearm({
      ...rearmBase,
      alreadyClaimedReplyOwner: null,
      allowAutoRearm: true,
    }),
    "non-iOS allowAutoRearm keeps schedule enabled",
  );
  assert(
    !guestStayShouldScheduleListenRearm({
      ...rearmBase,
      alreadyClaimedReplyOwner: null,
      allowAutoRearm: false,
    }),
    "iOS allowAutoRearm=false → no post-TTS auto-rearm schedule",
  );
  assert(
    !guestStayShouldScheduleListenRearm({ ...rearmBase, alreadyClaimedReplyOwner: 4 }),
    "same reply owner cannot claim listen rearm twice (no duplicate after re-render)",
  );
  assert(
    !guestStayShouldScheduleListenRearm({
      ...rearmBase,
      replyCurrent: 5,
      alreadyClaimedReplyOwner: null,
    }),
    "aborted/stale reply generation does not schedule rearm",
  );
  assert(
    !guestStayShouldScheduleListenRearm({
      ...rearmBase,
      chatCurrent: 3,
      alreadyClaimedReplyOwner: null,
    }),
    "stale chat generation does not schedule rearm",
  );

  const startBase = {
    ...rearmBase,
    welcomeLoading: false,
    welcomeSpeaking: false,
    sending: false,
    alreadyListening: false,
    speechSpeaking: false,
    listenCanStart: true,
  };
  assert(guestStayShouldStartListenRearm(startBase), "fallback speech end can restart listening once");
  assert(
    !guestStayShouldStartListenRearm({ ...startBase, welcomeSpeaking: true }),
    "no restart while welcome audio active",
  );
  assert(
    !guestStayShouldStartListenRearm({ ...startBase, welcomeLoading: true }),
    "no restart while welcome audio loading",
  );
  assert(
    !guestStayShouldStartListenRearm({ ...startBase, speechSpeaking: true }),
    "no restart while TTS still speaking",
  );
  assert(
    !guestStayShouldStartListenRearm({ ...startBase, sending: true }),
    "no restart while send is in flight",
  );
  assert(
    !guestStayShouldStartListenRearm({ ...startBase, alreadyListening: true }),
    "no restart while another listen session is active",
  );
  assert(
    !guestStayShouldStartListenRearm({ ...startBase, listenCanStart: false }),
    "no restart when listen support cannot start",
  );
  assert(
    !guestStayShouldStartListenRearm({ ...startBase, replyCurrent: 9 }),
    "stale reply does not start listen rearm",
  );

  assert(GUEST_STAY_POST_SPEECH_REARM_MS === 400, "English post-speech echo cooldown is 400ms");
  assert(GUEST_STAY_SPANISH_POST_TTS_SETTLE_MS === 1_000, "Spanish post-TTS settle is 1000ms");
  assert(guestStayPostSpeechRearmDelayMs("en") === GUEST_STAY_POST_SPEECH_REARM_MS, "English rearm timing unchanged");
  assert(
    guestStayPostSpeechRearmDelayMs("es") === GUEST_STAY_SPANISH_POST_TTS_SETTLE_MS,
    "Spanish TTS end waits settle delay before auto-rearm",
  );
  assert(guestStayPostSpeechRearmDelayMs("es") > guestStayPostSpeechRearmDelayMs("en"), "Spanish settle is longer than English");

  assert(guestStayIsIosUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "iPhone UA is iOS");
  assert(guestStayIsIosUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "iPad UA is iOS");
  assert(!guestStayIsIosUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"), "desktop Chrome is not iOS");
  assert(
    !guestStayPostSpeechListenRearmEnabled({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }),
    "iOS disables post-TTS listen auto-rearm",
  );
  assert(
    guestStayPostSpeechListenRearmEnabled({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      platform: "Win32",
      maxTouchPoints: 0,
    }),
    "desktop non-mobile keeps post-TTS listen auto-rearm",
  );
  assert(
    !guestStayPostSpeechListenRearmEnabled({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    "iPadOS desktop UA with touch is treated as mobile (no auto-rearm)",
  );
  assert(
    !guestStayPostSpeechListenRearmEnabled({
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36",
    }),
    "Android disables post-TTS listen auto-rearm",
  );

  assert(source.includes("GUEST_STAY_POST_SPEECH_REARM_MS"), "session uses the English post-speech cooldown");
  assert(source.includes("GUEST_STAY_SPANISH_POST_TTS_SETTLE_MS"), "session defines Spanish post-TTS settle");
  assert(source.includes("guestStayPostSpeechRearmDelayMs(listenLangRef.current)"), "rearm delay follows active listen language");
  assert(source.includes("scheduleListenRearmAfterReply"), "reply TTS end schedules listen rearm");
  assert(source.includes("listenRearmClaimedReplyRef"), "once-only rearm is claimed per reply owner");
  assert(source.includes("pendingReplySpeechRearmRef"), "browser speech fallback end can rearm listening");
  assert(source.includes("guestStayShouldScheduleListenRearm"), "schedule gate is shared");
  assert(source.includes("guestStayShouldStartListenRearm"), "start gate is shared");
  assert(source.includes("guestStayPostSpeechListenRearmEnabled"), "R4 iOS post-TTS rearm gate is present");
  assert(source.includes("guestStayIsIosUserAgent"), "R4 iOS UA helper is present");
  assert(
    /onEnded: \(endedGen\) => \{[\s\S]*scheduleListenRearmAfterReply\(endedGen, replyOwner\)/.test(source),
    "server TTS ended schedules listen rearm",
  );
  assert(
    /pendingReplySpeechRearmRef\.current = \{ chatOwner: ownerGeneration, replyOwner \}/.test(source),
    "browser fallback arms pending rearm before speaking",
  );
  assert(
    !/playWelcomeFallback[\s\S]*pendingReplySpeechRearmRef/.test(
      source.slice(source.indexOf("const playWelcomeFallback"), source.indexOf("const playBrowserFallback")),
    ),
    "welcome fallback does not arm reply listen rearm",
  );
  assert(source.includes("abortListening()"), "listening aborts before new reply TTS");
  const stayAudioFn = source.slice(source.indexOf("const requestStayAudio"), source.indexOf("const finishWelcomeLoading"));
  assert(stayAudioFn.includes("abortListening()"), "stay-tts path aborts mic before speaking");
  assert(source.includes("startListeningRef"), "auto-rearm calls the shared startListening path");
  assert(source.includes("void send(input)"), "typed chat still works");
  assert(source.includes("onClick={() => startListening()}"), "desktop manual push-to-talk still works");
  assert(source.includes("onPrimaryVoiceClick"), "mobile primary voice click remains for dormant path");
  assert(source.includes("startGuestStayMobileSttSession"), "mobile MediaRecorder session remains wired (dormant on simple mobile)");
  assert(source.includes("postGuestStayMobileTranscribe"), "mobile transcript posts to stay-transcribe (dormant UI)");
  assert(source.includes("GUEST_STAY_MOBILE_STT_COPY.stopSendEn"), "Stop & send copy remains for dormant path");
  assert(source.includes("GUEST_STAY_MOBILE_STT_COPY.startingEn"), "Starting microphone copy remains for dormant path");
  assert(source.includes("guestStayMobileServerSttPreferred"), "mobile server-STT preference gate is present");
  assert(source.includes("simpleMobileUi"), "simplified mobile UI gate is present");
  assert(source.includes("showCustomVoiceInput"), "custom Tap/Stop voice is gated off on simple mobile");
  assert(source.includes("!simpleMobileUi && mobileServerStt"), "mobile Server-STT UI stays dormant under simple mobile");
  assert(source.includes("GUEST_STAY_SIMPLE_MOBILE_COPY"), "simple mobile copy is present");
  assert(source.includes("guestStayChatMessagesForDisplay"), "mobile display filters seeded greeting");
  assert(source.includes("hideSeededGreeting: simpleMobileUi"), "mobile hides pre-populated Isabela intro card only");
  assert(
    guestStayChatMessagesForDisplay(initialGuestStayChatTranscript(), { hideSeededGreeting: true }).length === 0,
    "mobile does not show seeded bilingual intro bubble",
  );
  assert(
    guestStayChatMessagesForDisplay(initialGuestStayChatTranscript(), { hideSeededGreeting: false }).length === 1,
    "desktop still shows seeded greeting",
  );
  assert(
    guestStayChatMessagesForDisplay(
      [
        ...initialGuestStayChatTranscript(),
        { id: "elena-2", role: "elena", text: "Check-in is at 3pm." },
      ],
      { hideSeededGreeting: true },
    ).some((bubble) => bubble.text.includes("Check-in")),
    "mobile keeps real Isabela replies after chat starts",
  );
  assert(
    guestStayChatClearedUi({ includeGreeting: false }).messages.length === 0,
    "mobile Clear chat does not restore the old intro card",
  );
  assert(GUEST_STAY_SIMPLE_MOBILE_COPY.placeholderEn === "Ask Isabela anything…", "EN mobile placeholder");
  assert(GUEST_STAY_SIMPLE_MOBILE_COPY.placeholderEs === "Pregúntale a Isabela…", "ES mobile placeholder");
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.replyLangEn === "Reply language",
    "mobile labels EN/ES as reply language",
  );
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.replyLangEs === "Idioma de respuesta",
    "mobile labels EN/ES as idioma de respuesta",
  );
  assert(source.includes("replyLangEn"), "Reply language label renders on mobile");
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.dictateHelperEn.includes("same language on your phone keyboard"),
    "dictate helper clarifies phone keyboard language EN",
  );
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.dictateHelperEs.includes("mismo idioma en el teclado"),
    "dictate helper clarifies phone keyboard language ES",
  );
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.dictateCollapsedEn.includes("keyboard microphone to dictate"),
    "collapsed dictate helper EN",
  );
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.dictateCollapsedEs.includes("micrófono del teclado"),
    "collapsed dictate helper ES",
  );
  assert(!guestStaySimpleMobileDictateCollapsed(false), "dictate helper expands before first send");
  assert(guestStaySimpleMobileDictateCollapsed(true), "dictate helper collapses after first successful send");
  assert(source.includes("setMobileDictateCollapsed(true)"), "first successful send collapses dictate help");
  assert(source.includes("dictateHelperEn"), "full dictate help sits above the mobile input");
  assert(source.includes("onDictateMicHintClick"), "mobile mic hint button is present");
  assert(source.includes("dictateMicHintEn"), "mic hint toast copy EN");
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.dictateMicHintEn ===
      "Use the microphone on your phone keyboard to speak.",
    "mic hint toast EN text",
  );
  assert(
    GUEST_STAY_SIMPLE_MOBILE_COPY.dictateMicHintEs.includes("micrófono del teclado"),
    "mic hint toast ES text",
  );
  assert(source.includes('from "lucide-react"') && source.includes("Mic"), "uses lucide Mic icon");
  const micHintFn = source.slice(
    source.indexOf("const onDictateMicHintClick"),
    source.indexOf("const welcomeControls"),
  );
  assert(micHintFn.includes("messageInputElRef.current?.focus()"), "mic hint focuses the text input");
  assert(micHintFn.includes("setMobileMicHintVisible(true)"), "mic hint shows compact toast");
  assert(!micHintFn.includes("getUserMedia"), "mic hint does not request microphone permission");
  assert(!micHintFn.includes("MediaRecorder"), "mic hint does not start MediaRecorder");
  assert(!micHintFn.includes("startListening"), "mic hint does not start Web Speech");
  assert(!source.includes("helloEn"), "large Isabela intro card copy removed");
  assert(GUEST_STAY_SIMPLE_MOBILE_COPY.listenEn.includes("Listen"), "Listen replay keeps icon label");
  assert(
    guestStaySimpleMobileUiPreferred({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    }),
    "iOS renders simplified mobile UI preference",
  );
  assert(
    guestStaySimpleMobileUiPreferred({
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36",
    }),
    "Android renders simplified mobile UI preference",
  );
  assert(
    !guestStaySimpleMobileUiPreferred({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      platform: "Win32",
      maxTouchPoints: 0,
    }),
    "desktop Guest Stay remains non-simple (unchanged voice UX path)",
  );
  assert(source.includes("GUEST_STAY_SIMPLE_MOBILE_QUICK_ACTIONS"), "mobile quick actions render");
  assert(GUEST_STAY_SIMPLE_MOBILE_QUICK_ACTIONS.includes("check-in"), "quick Check-in present");
  assert(GUEST_STAY_SIMPLE_MOBILE_QUICK_ACTIONS.includes("checkout"), "quick Check-out present");
  assert(GUEST_STAY_SIMPLE_MOBILE_QUICK_ACTIONS.includes("access"), "quick Access present");
  assert(guestStaySimpleMobileQuickActionLabel("check-in", "es") === "Entrada", "ES quick Check-in label");
  assert(detectGuestStayChatIntent(guestStaySimpleMobileQuickActionMessage("check-in", "en")) === "check-in", "quick Check-in works");
  assert(detectGuestStayChatIntent(guestStaySimpleMobileQuickActionMessage("checkout", "en")) === "checkout", "quick Check-out works");
  assert(detectGuestStayChatIntent(guestStaySimpleMobileQuickActionMessage("wifi", "en")) === "private", "Access/Wi-Fi never reveals credentials via chat");
  assert(detectGuestStayChatIntent(guestStaySimpleMobileQuickActionMessage("nearby", "en")) === "maps-local-guide", "Nearby uses local-guide intent");
  assert(detectGuestStayChatIntent(guestStaySimpleMobileQuickActionMessage("things", "en")) === "tours", "Things to do uses tours intent");
  assert(source.includes("focusGuestStayAccessSection"), "Access quick action focuses secure Access section");
  assert(source.includes('id="guest-elena-message"'), "typed chat input remains");
  assert((source.match(/void send\(input\)/g) ?? []).length >= 1, "typed chat sends once via form submit");
  assert(source.includes("void sendRef.current(result.transcript)"), "mobile transcript enters existing send() once");
  assert(
    source.includes("guestStayChatRequestBody(token, message, listenLangRef.current)"),
    "send/TTS still pass preferredLang so resolveGuestStayChatLang receives UI preference",
  );
  assert(source.includes("GUEST_STAY_MOBILE_STT_COPY.failPermissionEn"), "permission failure uses dedicated copy");
  assert(source.includes("GUEST_STAY_MOBILE_STT_COPY.failRecorderEn"), "recorder failure uses dedicated copy");
  assert(source.includes("GUEST_STAY_MOBILE_STT_COPY.failHearEn"), "hear failure only after a successful recording");
  assert(source.includes("onRecordingStarted"), "Stop & send waits for recorder onstart");
  assert(source.includes('audio: true') || source.includes("getUserMedia"), "startup still uses getUserMedia");
  assert(source.includes('onClick={() => startListening()}'), "desktop Web Speech Tap path unchanged");
  assert(!source.includes("showCustomVoiceInput &&") || source.includes("showCustomVoiceInput"), "Tap-to-talk not exposed on simple mobile");
  assert(!/GUEST_STAY_LISTEN_COPY\.tapEn/.test(source.split("showCustomVoiceInput")[0] ?? "") || source.includes("showCustomVoiceInput ?"), "Tap labels only render inside custom-voice gate");
  assert(source.includes("clearListenRearmTimer"), "halt/clear cancels pending rearm timers");
  assert(source.includes("clearListenRearmTimer()"), "manual listen and halt cancel pending auto-rearm");
  const scheduleFn = source.slice(
    source.indexOf("const scheduleListenRearmAfterReply"),
    source.indexOf("const speechSynth = "),
  );
  assert(scheduleFn.includes("guestStayPostSpeechListenRearmEnabled"), "R4: schedule checks iOS before arming rearm");
  assert(scheduleFn.includes("clearListenRearmTimer()"), "R4 iOS path clears pending rearm timer");
  assert(scheduleFn.includes("pendingReplySpeechRearmRef.current = null"), "R4 iOS path clears pending browser rearm");
  assert(scheduleFn.includes("listenEngineRef.current.abort()"), "R4 iOS TTS end aborts any listen session → idle");
  assert(
    scheduleFn.includes('setListenStatus(listenSupport === "idle" ? "idle" : listenSupport)'),
    "R4 iOS returns listen UI to Tap to talk",
  );
  assert(scheduleFn.includes("guestStayPostSpeechRearmDelayMs"), "non-iOS schedule uses language-aware delay");
  assert(scheduleFn.includes("listenRearmClaimedReplyRef.current = replyOwner"), "non-iOS schedule claims once before timer");
  assert(scheduleFn.includes("startListeningRef.current()"), "non-iOS timer fires shared startListening once");
  assert(!scheduleFn.includes('setListenStatus("listening")'), "settle window does not mark listening early");
  assert(source.includes('useState<GuestStayListenLang>("en")'), "default listen language remains EN");
  const selectListenFn = source.slice(source.indexOf("const selectListenLang"), source.indexOf("const clearChat"));
  assert(!selectListenFn.includes("startListening(next)"), "R6: language switch never auto-restarts listening");
  assert(selectListenFn.includes("abortListening()"), "R6 aborts current listen on language switch");
}

const isDirectRun = process.argv[1]?.includes("guest-elena-text-card.test");
if (isDirectRun) {
  try {
    runGuestElenaTextCardTests();
    console.log("guest-elena-text-card tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-elena-text-card tests failed");
    process.exitCode = 1;
  }
}
