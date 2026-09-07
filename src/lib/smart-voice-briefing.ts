import type { Property, Reservation } from "@/lib/dashboard-data";

export const DEFAULT_HOST_TIMEZONE = "America/New_York";
export const HOST_TIMEZONE_STORAGE_KEY = "zencierge.hub.timezone";
export const HOST_LANGUAGE_STORAGE_KEY = "zencierge.hub.language";
/** Host preference: automatic Isabela login briefing voice on Overview open. */
export const HOST_ISABELA_AUTO_VOICE_KEY = "zencierge.hub.isabelaAutoVoice";
/** Session flag: auto-speak already attempted/claimed for this browser tab session. */
export const HOST_ISABELA_AUTO_VOICE_SESSION_KEY = "zencierge.hub.isabelaAutoVoice.sessionSpoken";

export type VoiceBriefingLanguage = "en" | "es";
export type IsabelaAutoVoicePreference = "enabled" | "disabled" | "unset";

/** Host-day slices for greetings and priority (login briefing v1). */
export type VoiceBriefingBlockId =
  | "morning_ops"
  | "pending_arrivals"
  | "checkins_incidents"
  | "overnight_urgent";

export type LoginBriefingPeriod = "morning" | "afternoon" | "evening";

export type HostLocalClock = {
  hour: number;
  minute: number;
  minutesOfDay: number;
  timeZone: string;
  dateIso: string;
};

export type VoiceBriefingBlock = {
  id: VoiceBriefingBlockId;
  label: string;
  focus: string;
  maxItems: number;
};

/**
 * Live-backed counts for the Smart Login Briefing.
 * `pendingMessages` / `maintenance` are reserved for a future live source and
 * must stay omitted from visible copy until those sources exist.
 */
export type LoginBriefingCounts = {
  arrivals: number;
  departures: number;
  housekeepingPending: number;
  pendingMessages?: number;
  maintenance?: number;
};

export type LoginBriefingLiveSources = {
  reservations: boolean;
  housekeeping: boolean;
  /** Always false in v1 — no live guest-message inbox. */
  guestMessages: boolean;
  /** Always false in v1 — no live maintenance ticket store. */
  maintenance: boolean;
};

export const LOGIN_BRIEFING_V1_LIVE_SOURCES: LoginBriefingLiveSources = {
  reservations: true,
  housekeeping: true,
  guestMessages: false,
  maintenance: false,
};

export type SmartLoginBriefing = {
  greeting: string;
  period: LoginBriefingPeriod;
  clock: HostLocalClock;
  counts: LoginBriefingCounts;
  sentence: string;
  spokenText: string;
};

/** @deprecated Prefer SmartLoginBriefing; kept for voice-card compatibility. */
export type VoiceBriefingUrgency = "emergency" | "incident" | "arrival" | "ops";
/** @deprecated Prefer SmartLoginBriefing. */
export type VoiceBriefingItem = {
  id: string;
  text: string;
  urgency: VoiceBriefingUrgency;
};
/** @deprecated Prefer SmartLoginBriefing. */
export type SmartVoiceBriefing = {
  greeting: string;
  block: VoiceBriefingBlock;
  clock: HostLocalClock;
  items: VoiceBriefingItem[];
  omittedCount: number;
  spokenText: string;
};

const BLOCKS: Record<VoiceBriefingBlockId, VoiceBriefingBlock> = {
  morning_ops: {
    id: "morning_ops",
    label: "Morning",
    focus: "Departures, cleanings, and arrivals",
    maxItems: 4,
  },
  pending_arrivals: {
    id: "pending_arrivals",
    label: "Afternoon",
    focus: "Arrivals and open cleanings",
    maxItems: 4,
  },
  checkins_incidents: {
    id: "checkins_incidents",
    label: "Evening",
    focus: "Remaining arrivals and cleanings",
    maxItems: 3,
  },
  overnight_urgent: {
    id: "overnight_urgent",
    label: "Evening",
    focus: "Remaining arrivals and cleanings",
    maxItems: 2,
  },
};

function parsePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const raw = parts.find((part) => part.type === type)?.value;
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? n : NaN;
}

function isValidIanaTimeZone(timeZone: string) {
  const zone = timeZone.trim();
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Host wall-clock in `timeZone` (IANA), not the browser’s default unless they match.
 */
export function hostLocalClock(timeZone = DEFAULT_HOST_TIMEZONE, now = new Date()): HostLocalClock {
  const zone = isValidIanaTimeZone(timeZone) ? timeZone.trim() : DEFAULT_HOST_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  let hour = parsePart(parts, "hour");
  const minute = parsePart(parts, "minute");
  if (!Number.isFinite(hour)) hour = now.getHours();
  if (hour === 24) hour = 0;
  const minuteSafe = Number.isFinite(minute) ? minute : now.getMinutes();

  const year = parsePart(parts, "year");
  const month = parsePart(parts, "month");
  const day = parsePart(parts, "day");
  const dateIso =
    Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
      ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : now.toISOString().slice(0, 10);

  return {
    hour,
    minute: minuteSafe,
    minutesOfDay: hour * 60 + minuteSafe,
    timeZone: zone,
    dateIso,
  };
}

/**
 * Prefer saved host timezone, then a valid property timezone, never browser-local invent.
 */
export function resolveHostBriefingTimeZone(input: {
  storedTimeZone?: string | null;
  propertyTimeZones?: readonly (string | null | undefined)[];
}): string {
  const stored = typeof input.storedTimeZone === "string" ? input.storedTimeZone.trim() : "";
  if (stored && isValidIanaTimeZone(stored)) return stored;
  for (const candidate of input.propertyTimeZones ?? []) {
    const zone = typeof candidate === "string" ? candidate.trim() : "";
    if (zone && isValidIanaTimeZone(zone)) return zone;
  }
  return DEFAULT_HOST_TIMEZONE;
}

export function parseHostBriefingLanguage(value: unknown): VoiceBriefingLanguage {
  return value === "es" ? "es" : "en";
}

export function readStoredHostBriefingLanguage(): VoiceBriefingLanguage {
  if (typeof window === "undefined") return "en";
  return parseHostBriefingLanguage(window.localStorage.getItem(HOST_LANGUAGE_STORAGE_KEY));
}

export function writeStoredHostBriefingLanguage(language: VoiceBriefingLanguage) {
  if (typeof window === "undefined") return language;
  const value = parseHostBriefingLanguage(language);
  window.localStorage.setItem(HOST_LANGUAGE_STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent("zencierge-host-language", { detail: value }));
  return value;
}

function getSessionStore(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
    const globalStore = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (globalStore) return globalStore;
  } catch {
    return null;
  }
  return null;
}

function getLocalStore(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    const globalStore = (globalThis as { localStorage?: Storage }).localStorage;
    if (globalStore) return globalStore;
  } catch {
    return null;
  }
  return null;
}

export function parseIsabelaAutoVoicePreference(value: unknown): IsabelaAutoVoicePreference {
  if (value === "1" || value === "enabled" || value === true) return "enabled";
  if (value === "0" || value === "disabled" || value === false) return "disabled";
  return "unset";
}

export function readIsabelaAutoVoicePreference(): IsabelaAutoVoicePreference {
  const store = getLocalStore();
  if (!store) return "unset";
  return parseIsabelaAutoVoicePreference(store.getItem(HOST_ISABELA_AUTO_VOICE_KEY));
}

export function writeIsabelaAutoVoicePreference(preference: "enabled" | "disabled") {
  const store = getLocalStore();
  const value = preference === "enabled" ? "1" : "0";
  if (store) store.setItem(HOST_ISABELA_AUTO_VOICE_KEY, value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zencierge-host-isabela-auto-voice", { detail: preference }));
  }
  return preference;
}

export function hasIsabelaAutoVoiceSpokenThisSession(): boolean {
  const store = getSessionStore();
  if (!store) return false;
  try {
    return store.getItem(HOST_ISABELA_AUTO_VOICE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Claim the once-per-session auto-speak slot. Returns false if already claimed. */
export function claimIsabelaAutoVoiceSessionSpeak(): boolean {
  const store = getSessionStore();
  if (!store) return false;
  try {
    if (store.getItem(HOST_ISABELA_AUTO_VOICE_SESSION_KEY) === "1") return false;
    store.setItem(HOST_ISABELA_AUTO_VOICE_SESSION_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether Overview should attempt an automatic Isabela greeting.
 * Disabled preference never auto-speaks. Session claim prevents re-renders / polls from repeating.
 */
export function shouldAttemptIsabelaAutoSpeak(input: {
  preference: IsabelaAutoVoicePreference;
  sessionAlreadySpoken: boolean;
  listingsLoading: boolean;
  playbackBusy: boolean;
}): boolean {
  if (input.listingsLoading) return false;
  if (input.playbackBusy) return false;
  if (input.preference === "disabled") return false;
  if (input.sessionAlreadySpoken) return false;
  return true;
}

/**
 * 5:00–11:59 morning · 12:00–5:59 PM afternoon · 6:00 PM–4:59 AM evening.
 */
export function resolveLoginBriefingPeriod(hour: number, minute = 0): LoginBriefingPeriod {
  const t = hour * 60 + minute;
  if (t >= 5 * 60 && t < 12 * 60) return "morning";
  if (t >= 12 * 60 && t < 18 * 60) return "afternoon";
  return "evening";
}

/**
 * Maps login periods onto the legacy block ids used by Centro finance greetings.
 * 5:00–11:59 AM morning ops · 12:00–5:59 PM pending/arrivals ·
 * 6:00–11:59 PM check-ins · 12:00–4:59 AM overnight (still “Good evening”).
 */
export function resolveVoiceBriefingBlock(hour: number, minute = 0): VoiceBriefingBlock {
  const t = hour * 60 + minute;
  if (t >= 5 * 60 && t < 12 * 60) return BLOCKS.morning_ops;
  if (t >= 12 * 60 && t < 18 * 60) return BLOCKS.pending_arrivals;
  if (t >= 18 * 60 && t < 24 * 60) return BLOCKS.checkins_incidents;
  return BLOCKS.overnight_urgent;
}

export function voiceBriefingGreeting(
  blockId: VoiceBriefingBlockId,
  language: VoiceBriefingLanguage,
  hostFirstName: string,
): string {
  const name = hostFirstName.trim() || "Host";
  if (language === "es") {
    if (blockId === "morning_ops") return `Buenos días, ${name}.`;
    if (blockId === "pending_arrivals") return `Buenas tardes, ${name}.`;
    return `Buenas noches, ${name}.`;
  }
  if (blockId === "morning_ops") return `Good morning, ${name}.`;
  if (blockId === "pending_arrivals") return `Good afternoon, ${name}.`;
  return `Good evening, ${name}.`;
}

export function loginBriefingGreeting(
  period: LoginBriefingPeriod,
  language: VoiceBriefingLanguage,
  hostFirstName: string,
): string {
  const blockId: VoiceBriefingBlockId =
    period === "morning" ? "morning_ops" : period === "afternoon" ? "pending_arrivals" : "checkins_incidents";
  return voiceBriefingGreeting(blockId, language, hostFirstName);
}

function isCanceledReservationStatus(status: string) {
  const value = status.trim().toLowerCase();
  return value === "canceled" || value === "cancelled" || value === "invalid" || value === "void";
}

function stayDate(value: string | undefined) {
  if (typeof value !== "string") return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? "";
}

/** Same-day arrivals and departures from live reservation rows only. */
export function countSameDayReservationMoves(
  reservations: readonly { checkIn: string; checkOut: string; status: string }[],
  dateIso: string,
): Pick<LoginBriefingCounts, "arrivals" | "departures"> {
  let arrivals = 0;
  let departures = 0;
  const day = stayDate(dateIso);
  if (!day) return { arrivals: 0, departures: 0 };
  for (const stay of reservations) {
    if (isCanceledReservationStatus(stay.status ?? "")) continue;
    if (stayDate(stay.checkIn) === day) arrivals += 1;
    if (stayDate(stay.checkOut) === day) departures += 1;
  }
  return { arrivals, departures };
}

export function parsePendingHousekeepingCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as { pendingHousekeepingCount?: unknown }).pendingHousekeepingCount;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function phraseCount(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

function joinClauses(language: VoiceBriefingLanguage, clauses: string[]) {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) {
    return language === "es" ? `${clauses[0]} y ${clauses[1]}` : `${clauses[0]} and ${clauses[1]}`;
  }
  const head = clauses.slice(0, -1).join(", ");
  const last = clauses[clauses.length - 1];
  return language === "es" ? `${head} y ${last}` : `${head}, and ${last}`;
}

function orderedLoginClauses(
  period: LoginBriefingPeriod,
  counts: LoginBriefingCounts,
  sources: LoginBriefingLiveSources,
  language: VoiceBriefingLanguage,
): string[] {
  const clauses: string[] = [];
  const pushArrival = () => {
    if (!sources.reservations || counts.arrivals <= 0) return;
    clauses.push(
      language === "es"
        ? phraseCount(counts.arrivals, "llegada pendiente", "llegadas pendientes")
        : phraseCount(counts.arrivals, "arrival", "arrivals"),
    );
  };
  const pushDeparture = () => {
    if (!sources.reservations || counts.departures <= 0) return;
    clauses.push(
      language === "es"
        ? phraseCount(counts.departures, "salida", "salidas")
        : phraseCount(counts.departures, "departure", "departures"),
    );
  };
  const pushHousekeeping = () => {
    if (!sources.housekeeping || counts.housekeepingPending <= 0) return;
    clauses.push(
      language === "es"
        ? phraseCount(counts.housekeepingPending, "limpieza pendiente", "limpiezas pendientes")
        : phraseCount(counts.housekeepingPending, "cleaning pending", "cleanings pending"),
    );
  };
  // Future live categories — intentionally gated off in v1.
  const pushMessages = () => {
    if (!sources.guestMessages || !counts.pendingMessages || counts.pendingMessages <= 0) return;
    clauses.push(
      language === "es"
        ? phraseCount(counts.pendingMessages, "mensaje de huésped pendiente", "mensajes de huésped pendientes")
        : phraseCount(counts.pendingMessages, "pending guest message", "pending guest messages"),
    );
  };
  const pushMaintenance = () => {
    if (!sources.maintenance || !counts.maintenance || counts.maintenance <= 0) return;
    clauses.push(
      language === "es"
        ? phraseCount(counts.maintenance, "mantenimiento pendiente", "mantenimientos pendientes")
        : phraseCount(counts.maintenance, "maintenance item", "maintenance items"),
    );
  };

  if (period === "morning") {
    pushDeparture();
    pushHousekeeping();
    pushArrival();
  } else {
    pushMessages();
    pushMaintenance();
    pushArrival();
    pushHousekeeping();
  }
  return clauses;
}

function calmBody(language: VoiceBriefingLanguage, counts: LoginBriefingCounts, sources: LoginBriefingLiveSources) {
  const hkClear = !sources.housekeeping || counts.housekeepingPending <= 0;
  const movesClear =
    !sources.reservations || (counts.arrivals <= 0 && counts.departures <= 0);
  if (language === "es") {
    if (hkClear && movesClear) {
      return "Todo al día por ahora: sin llegadas, salidas ni limpiezas pendientes.";
    }
    if (hkClear) return "Todas las limpiezas están al día.";
    return "Nada urgente en este momento.";
  }
  if (hkClear && movesClear) {
    return "All clear for now — no arrivals, departures, or cleanings pending.";
  }
  if (hkClear) return "All cleanings are up to date.";
  return "Nothing urgent right now.";
}

/**
 * Compact login sentence. Omits zero counts and never surfaces guest-message /
 * maintenance numbers unless those live sources are explicitly enabled.
 */
export function composeLoginBriefingSentence(input: {
  language: VoiceBriefingLanguage;
  period: LoginBriefingPeriod;
  counts: LoginBriefingCounts;
  sources?: LoginBriefingLiveSources;
}): string {
  const language = input.language === "es" ? "es" : "en";
  const sources = input.sources ?? LOGIN_BRIEFING_V1_LIVE_SOURCES;
  const clauses = orderedLoginClauses(input.period, input.counts, sources, language);
  if (clauses.length === 0) return calmBody(language, input.counts, sources);

  const joined = joinClauses(language, clauses);
  const hkClearNote =
    sources.housekeeping && input.counts.housekeepingPending <= 0
      ? language === "es"
        ? " y todas las limpiezas están al día"
        : ", and all cleanings are up to date"
      : "";
  if (language === "es") {
    if (input.period === "morning") return `Tienes ${joined}${hkClearNote} hoy.`;
    return `Tienes ${joined}${hkClearNote}.`;
  }
  if (input.period === "morning") return `You have ${joined}${hkClearNote} today.`;
  return `You have ${joined}${hkClearNote}.`;
}

export function composeSmartLoginBriefing(input: {
  hostFirstName: string;
  language?: VoiceBriefingLanguage;
  timeZone?: string;
  counts: LoginBriefingCounts;
  sources?: LoginBriefingLiveSources;
  now?: Date;
}): SmartLoginBriefing {
  const language = parseHostBriefingLanguage(input.language);
  const clock = hostLocalClock(input.timeZone, input.now);
  const period = resolveLoginBriefingPeriod(clock.hour, clock.minute);
  const greeting = loginBriefingGreeting(period, language, input.hostFirstName);
  const sentence = composeLoginBriefingSentence({
    language,
    period,
    counts: input.counts,
    sources: input.sources,
  });
  return {
    greeting,
    period,
    clock,
    counts: input.counts,
    sentence,
    spokenText: `${greeting} ${sentence}`.trim(),
  };
}

/** Voice-card compatibility wrapper around the login briefing sentence. */
export function composeSmartVoiceBriefing(input: {
  hostFirstName: string;
  language?: VoiceBriefingLanguage;
  timeZone?: string;
  items?: VoiceBriefingItem[];
  counts?: LoginBriefingCounts;
  sources?: LoginBriefingLiveSources;
  now?: Date;
}): SmartVoiceBriefing {
  const login = composeSmartLoginBriefing({
    hostFirstName: input.hostFirstName,
    language: input.language,
    timeZone: input.timeZone,
    counts: input.counts ?? { arrivals: 0, departures: 0, housekeepingPending: 0 },
    sources: input.sources,
    now: input.now,
  });
  const block = resolveVoiceBriefingBlock(login.clock.hour, login.clock.minute);
  return {
    greeting: login.greeting,
    block,
    clock: login.clock,
    items: [],
    omittedCount: 0,
    spokenText: login.spokenText,
  };
}

/**
 * @deprecated Seed call/ops collectors must not drive login briefing counts.
 * Kept as a no-op empty list so older imports fail closed instead of inventing numbers.
 */
export function collectHostVoiceBriefingItems(_input?: {
  properties: Property[];
  reservations: Reservation[];
  calls?: unknown;
  dateIso: string;
}): VoiceBriefingItem[] {
  void _input;
  return [];
}
