/** Browser-safe playback key. The server issues the value; this only remembers it for one action. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const HOST_TTS_USAGE_KEY_HEADER = "x-zencierge-usage-key";

const keys = new Map<string, string>();

/** A new click starts a new action. The id is not derived from the spoken text. */
export function beginHostTtsPlaybackAction(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return "00000000-0000-4000-8000-000000000000";
}

export function hostTtsUsageKeyForAction(actionId: string): string | null {
  return keys.get(actionId) ?? null;
}

export function rememberHostTtsUsageKey(actionId: string, key: string | null | undefined) {
  const value = key?.trim() ?? "";
  if (!actionId || !UUID_RE.test(value)) return;
  keys.set(actionId, value);
}

export function forgetHostTtsUsageKey(actionId: string) {
  keys.delete(actionId);
}

/** Test hook. */
export function resetHostTtsUsageKeyForTests() {
  keys.clear();
}
