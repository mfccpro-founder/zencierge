"use client";

import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";

/** Static text → /api/tts widget. No SpeechRecognition, mic, or auto audio. */
export function ElenaWelcomeAvatar() {
  return <ElenaVoiceWidget />;
}
