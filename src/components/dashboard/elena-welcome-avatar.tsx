"use client";

import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";

/** Static text → /api/tts widget. No mic or auto-voice features. */
export function ElenaWelcomeAvatar() {
  return <ElenaVoiceWidget />;
}
