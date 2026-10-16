/** Server flag for host `/api/tts` metering. Unset means off. */
export const HOST_TTS_METER_FLAG = "AI_USAGE_HOST_TTS_METER";

export function hostTtsMeterEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[HOST_TTS_METER_FLAG]?.trim() === "1";
}
