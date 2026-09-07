import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hashStayToken,
  isCanceledReservationStatus,
  parseClockTime,
  parseStayTokenBody,
  stayExpiresAt,
  withPropertyStayTimes,
  type StayTokenStore,
} from "@/lib/guest-stay-token";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("guest-stay-access is server-only");
}

export const GUEST_STAY_ACCESS_MAX_BODY_BYTES = 4096;
export const GUEST_STAY_ACCESS_MAX_FIELD_CHARS = 128;
export const GUEST_STAY_ACCESS_RATE_MAX = 8;
export const GUEST_STAY_ACCESS_RATE_WINDOW_MS = 60_000;
export const GUEST_STAY_ACCESS_PROPERTY_COLUMNS = "id, wifi_network, wifi_password, door_code" as const;

export type GuestStayAccessError = "invalid" | "expired" | "revoked" | "unavailable";

export type GuestStayAccessFields = {
  id: string;
  wifiNetwork: string;
  wifiPassword: string;
  doorCode: string;
};

export type GuestStayAccessLookup =
  | { kind: "row"; row: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "error" };

export type GuestStayAccessStore = {
  getAccessFields(propertyId: string): Promise<GuestStayAccessLookup>;
};

export type GuestStayAccessRateLimiter = {
  limited: (key: string) => boolean;
};

export type GuestStayAccessResult = { status: number; body: Record<string, unknown> };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PENDING_KEYS = ["ok", "status"] as const;
const READY_KEYS = ["ok", "status", "wifiNetwork", "wifiPassword", "doorCode"] as const;

function zonedLocalToUtc(year: number, month: number, day: number, hours: number, minutes: number, timeZone: string) {
  const zone = timeZone.trim() || "UTC";
  let utc = Date.UTC(year, month - 1, day, hours, minutes, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
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

export function stayAccessStartsAt(input: { checkInDate: string; checkInTime: string; timeZone?: string }): Date | null {
  const dateMatch = DATE_RE.exec(input.checkInDate.trim());
  if (!dateMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const clock = parseClockTime(input.checkInTime) ?? { hours: 0, minutes: 0 };
  const zone = input.timeZone?.trim() || "UTC";
  const starts = zonedLocalToUtc(year, month, day, clock.hours, clock.minutes, zone);
  return Number.isNaN(starts.getTime()) ? null : starts;
}

export function guestStayAccessJson(data: unknown, status: number) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function createGuestStayAccessRateLimiter(
  max = GUEST_STAY_ACCESS_RATE_MAX,
  windowMs = GUEST_STAY_ACCESS_RATE_WINDOW_MS,
): GuestStayAccessRateLimiter {
  const hits = new Map<string, number[]>();
  return {
    limited(key: string) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return true;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 500) {
        const oldest = hits.keys().next().value;
        if (oldest) hits.delete(oldest);
      }
      return false;
    },
  };
}

export function guestStayAccessContentLengthRejected(contentLength: number | null | undefined) {
  if (contentLength == null) return false;
  return !Number.isFinite(contentLength) || contentLength > GUEST_STAY_ACCESS_MAX_BODY_BYTES;
}

export function guestStayAccessSerializedBodyTooLarge(body: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(body), "utf8") > GUEST_STAY_ACCESS_MAX_BODY_BYTES;
  } catch {
    return true;
  }
}

function fail(status: number, error: GuestStayAccessError): GuestStayAccessResult {
  return { status, body: { error } };
}

function pendingBody(): Record<string, unknown> {
  return { ok: true, status: "pending" };
}

function readyBody(fields: GuestStayAccessFields): Record<string, unknown> {
  return {
    ok: true,
    status: "ready",
    wifiNetwork: fields.wifiNetwork,
    wifiPassword: fields.wifiPassword,
    doorCode: fields.doorCode,
  };
}

export function guestStayAccessPendingKeys() {
  return [...PENDING_KEYS];
}

export function guestStayAccessReadyKeys() {
  return [...READY_KEYS];
}

function asAccessField(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  if (value.length > GUEST_STAY_ACCESS_MAX_FIELD_CHARS) return null;
  return value;
}

function mapAccessFields(row: Record<string, unknown>, propertyId: string): GuestStayAccessFields | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id || id !== propertyId) return null;
  const wifiNetwork = asAccessField(row.wifi_network);
  const wifiPassword = asAccessField(row.wifi_password);
  const doorCode = asAccessField(row.door_code);
  if (wifiNetwork == null || wifiPassword == null || doorCode == null) return null;
  return { id, wifiNetwork, wifiPassword, doorCode };
}

export function createMemoryStayAccessStore(input: {
  rows?: Record<string, Record<string, unknown>>;
  fail?: boolean;
  throwOnRead?: boolean;
  onRead?: (propertyId: string) => void;
} = {}): GuestStayAccessStore & { reads: string[] } {
  const rows = { ...(input.rows ?? {}) };
  const reads: string[] = [];
  return {
    reads,
    async getAccessFields(propertyId) {
      reads.push(propertyId);
      input.onRead?.(propertyId);
      if (input.throwOnRead) throw new Error("store-throw");
      if (input.fail) return { kind: "error" };
      const row = rows[propertyId];
      if (!row) return { kind: "missing" };
      return { kind: "row", row };
    },
  };
}

export function createSupabaseStayAccessStore(admin: SupabaseClient): GuestStayAccessStore {
  return {
    async getAccessFields(propertyId) {
      const listed = await admin
        .from("properties")
        .select(GUEST_STAY_ACCESS_PROPERTY_COLUMNS)
        .eq("id", propertyId)
        .maybeSingle();
      if (listed.error) return { kind: "error" };
      if (!listed.data || typeof listed.data !== "object" || Array.isArray(listed.data)) return { kind: "missing" };
      return { kind: "row", row: listed.data as Record<string, unknown> };
    },
  };
}

export async function handleGuestStayAccess(input: {
  body: unknown;
  contentLength?: number | null;
  ipKey: string;
  now?: Date;
  tokenStore: StayTokenStore;
  accessStore: GuestStayAccessStore;
  ipLimiter: GuestStayAccessRateLimiter;
  tokenLimiter: GuestStayAccessRateLimiter;
}): Promise<GuestStayAccessResult> {
  try {
    if (guestStayAccessContentLengthRejected(input.contentLength)) return fail(400, "invalid");
    if (guestStayAccessSerializedBodyTooLarge(input.body)) return fail(400, "invalid");

    const parsed = parseStayTokenBody(input.body);
    if ("error" in parsed) return fail(400, "invalid");

    if (input.ipLimiter.limited(input.ipKey)) return fail(429, "unavailable");
    if (input.tokenLimiter.limited(hashStayToken(parsed.token))) return fail(429, "unavailable");

    const row = await input.tokenStore.findByHash(hashStayToken(parsed.token));
    if (!row) return fail(404, "invalid");
    if (row.revoked_at) return fail(410, "revoked");

    const now = input.now ?? new Date();
    if (new Date(row.expires_at).getTime() <= now.getTime()) return fail(410, "expired");

    const loadedReservation = await input.tokenStore.getReservation(row.reservation_id);
    if (!loadedReservation) return fail(409, "unavailable");
    if (loadedReservation.property_id !== row.property_id) return fail(409, "unavailable");
    if (isCanceledReservationStatus(loadedReservation.status)) return fail(409, "unavailable");

    const property = await input.tokenStore.getProperty(row.property_id);
    if (!property || property.id !== loadedReservation.property_id) return fail(409, "unavailable");

    const reservation = withPropertyStayTimes(loadedReservation, property);
    const liveExpires = stayExpiresAt({
      checkOutDate: reservation.check_out,
      checkOutTime: reservation.check_out_time,
      timeZone: property.timezone,
    });
    if (!liveExpires || liveExpires.getTime() <= now.getTime()) return fail(410, "expired");

    const liveStarts = stayAccessStartsAt({
      checkInDate: reservation.check_in,
      checkInTime: reservation.check_in_time,
      timeZone: property.timezone,
    });
    if (!liveStarts) return fail(409, "unavailable");
    if (now.getTime() < liveStarts.getTime()) {
      const body = pendingBody();
      if (Object.keys(body).join(",") !== PENDING_KEYS.join(",")) return fail(503, "unavailable");
      return { status: 200, body };
    }

    const listed = await input.accessStore.getAccessFields(property.id);
    if (listed.kind === "error") return fail(503, "unavailable");
    if (listed.kind === "missing") return fail(409, "unavailable");
    const fields = mapAccessFields(listed.row, property.id);
    if (!fields) return fail(503, "unavailable");
    const body = readyBody(fields);
    if (Object.keys(body).join(",") !== READY_KEYS.join(",")) return fail(503, "unavailable");
    return { status: 200, body };
  } catch {
    return fail(503, "unavailable");
  }
}
