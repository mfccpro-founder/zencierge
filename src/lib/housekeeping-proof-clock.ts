import { calendarToday } from "@/lib/dashboard-data";

/** Default Florida listing zone used by the host dashboard demo properties. */
export const HOUSEKEEPING_PROOF_DEMO_TIMEZONE = "America/New_York";
export const HOUSEKEEPING_PROOF_DEMO_LOCAL_HOUR = 12;
export const HOUSEKEEPING_PROOF_DEMO_LOCAL_MINUTE = 0;

/** Single source for proof-stage open-window durations (must match RPC token lifetime intent). */
export const HOUSEKEEPING_PROOF_STAGE_WINDOW_MS = {
  post_checkout: 24 * 60 * 60 * 1000,
  ready_for_checkin: 2 * 60 * 60 * 1000,
} as const;

export type HousekeepingProofClockStage = keyof typeof HOUSEKEEPING_PROOF_STAGE_WINDOW_MS;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Local-demo clock is active only outside production.
 * Matches the existing `allowDevHostSession()` / `NODE_ENV !== "production"` gate.
 */
export function isHousekeepingProofDemoClockEnabled(nodeEnv?: string): boolean {
  return (nodeEnv ?? process.env.NODE_ENV) !== "production";
}

export function housekeepingProofStageWindowMs(stage: HousekeepingProofClockStage): number {
  return HOUSEKEEPING_PROOF_STAGE_WINDOW_MS[stage];
}

/**
 * Development-only: when demo eligibility used an absolute expiry already past the real wall clock,
 * rematerialize expiresAt from wall time + the stage's existing maximum duration.
 * Production and explicit `now` test overrides never rematerialize.
 */
export function rematerializeHousekeepingProofDemoExpiresAt(input: {
  stage: HousekeepingProofClockStage;
  expiresAt: Date;
  nodeEnv?: string;
  hasExplicitNow?: boolean;
  wallNow?: Date;
}): Date {
  if (input.hasExplicitNow) return input.expiresAt;
  if (!isHousekeepingProofDemoClockEnabled(input.nodeEnv)) return input.expiresAt;
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) return input.expiresAt;
  const wall =
    input.wallNow instanceof Date && !Number.isNaN(input.wallNow.getTime()) ? input.wallNow : new Date();
  if (input.expiresAt.getTime() > wall.getTime()) return input.expiresAt;
  return new Date(wall.getTime() + housekeepingProofStageWindowMs(input.stage));
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
) {
  let utc = Date.UTC(year, month - 1, day, hours, minutes, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(utc));
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    let localHour = read("hour");
    if (localHour === 24) localHour = 0;
    const asIfUtc = Date.UTC(read("year"), read("month") - 1, read("day"), localHour, read("minute"));
    const wanted = Date.UTC(year, month - 1, day, hours, minutes);
    utc += wanted - asIfUtc;
  }
  return new Date(utc);
}

function resolveDemoTimeZone(timeZone: string | undefined) {
  const zone = typeof timeZone === "string" ? timeZone.trim() : "";
  if (!zone) return HOUSEKEEPING_PROOF_DEMO_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return HOUSEKEEPING_PROOF_DEMO_TIMEZONE;
  }
}

/** Midday on the host-dashboard demonstration date, in the property (or default) timezone. */
export function housekeepingProofDemoInstant(input?: { date?: string; timeZone?: string }): Date {
  const date = typeof input?.date === "string" && input.date.trim() ? input.date.trim() : calendarToday;
  const match = DATE_RE.exec(date);
  if (!match) return new Date();
  const timeZone = resolveDemoTimeZone(input?.timeZone);
  return zonedLocalToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    HOUSEKEEPING_PROOF_DEMO_LOCAL_HOUR,
    HOUSEKEEPING_PROOF_DEMO_LOCAL_MINUTE,
    timeZone,
  );
}

/**
 * Single Housekeeping-proof clock for options, issue, validate, and upload.
 * Explicit `now` always wins (tests). Production always uses the wall clock.
 */
export function housekeepingProofNow(input?: {
  now?: Date;
  nodeEnv?: string;
  timeZone?: string;
}): Date {
  if (input?.now instanceof Date && !Number.isNaN(input.now.getTime())) return input.now;
  const nodeEnv = input?.nodeEnv ?? process.env.NODE_ENV;
  if (!isHousekeepingProofDemoClockEnabled(nodeEnv)) return new Date();
  return housekeepingProofDemoInstant({ timeZone: input?.timeZone });
}
