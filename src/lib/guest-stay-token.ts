import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeLocalGuideWrite } from "@/lib/local-guide-shared";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  LIVE_RESERVATION_STAY_COLUMNS,
  eligibleHostQrStays,
  hostQrStayPayloadHasForbiddenFields,
  hostQrStaysPayload,
  isoDateFromUnknown,
  todayIsoDate,
  type LiveReservationMask,
} from "@/lib/guest-stay-qr";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("guest-stay-token is server-only");
}

export const GUEST_STAY_TOKEN_BYTES = 32;
export const GUEST_STAY_PUBLIC_PATH_PREFIX = "/guest/s/";

const TOKEN_CHARSET = /^[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const FORBIDDEN_PUBLIC_KEYS = [
  "address",
  "street",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "coordinates",
  "wifi",
  "wifiNetwork",
  "wifiPassword",
  "wifi_network",
  "wifi_password",
  "door",
  "doorCode",
  "door_code",
  "gate",
  "gateCode",
  "gate_code",
  "lockbox",
  "alarm",
  "access_code",
  "accessCode",
  "handbook",
  "ai_handbook",
  "phone",
  "email",
  "guest",
  "full_name",
  "fullName",
  "assignedPhoneNumber",
  "assigned_phone_number",
  "hostPhone",
  "hostEmail",
] as const;

export type StayErrorCode = "invalid" | "expired" | "revoked" | "unavailable";

export type StayReservationRecord = {
  id: string;
  property_id: string;
  check_in: string;
  check_in_time: string;
  check_out: string;
  check_out_time: string;
  status: string;
};

export type StayPropertyRecord = {
  id: string;
  name: string;
  city: string;
  timezone: string;
  checkInTime?: string;
  checkOutTime?: string;
};

export type GuestStayTokenRow = {
  id: string;
  token_hash: string;
  reservation_id: string;
  property_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
};

export type PublicStayMetadata = {
  stayId: string;
  propertyName: string;
  city: string;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  status: "active";
};

export type StayTokenStore = {
  getReservation(id: string): Promise<StayReservationRecord | null>;
  getProperty(id: string): Promise<StayPropertyRecord | null>;
  listActiveHashes(reservationId: string): Promise<string[]>;
  revokeActiveForReservation(reservationId: string, atIso: string): Promise<void>;
  insertToken(row: GuestStayTokenRow): Promise<GuestStayTokenRow>;
  findByHash(tokenHash: string): Promise<GuestStayTokenRow | null>;
};

export function generateStayToken() {
  return randomBytes(GUEST_STAY_TOKEN_BYTES).toString("base64url");
}

export function hashStayToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidStayTokenFormat(token: unknown): token is string {
  if (typeof token !== "string") return false;
  if (!TOKEN_CHARSET.test(token)) return false;
  if (token.length < 43 || token.length > 64) return false;
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const bytes = Buffer.from(`${padded}${pad}`, "base64");
    return bytes.length >= GUEST_STAY_TOKEN_BYTES;
  } catch {
    return false;
  }
}

export function parseStayLinkBody(body: unknown): { reservationId: string } | { error: StayErrorCode } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid" };
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "reservationId") return { error: "invalid" };
  const reservationId = typeof (body as { reservationId?: unknown }).reservationId === "string"
    ? (body as { reservationId: string }).reservationId.trim()
    : "";
  if (!reservationId || reservationId.length > 80) return { error: "invalid" };
  return { reservationId };
}

export function parseStayTokenBody(body: unknown): { token: string } | { error: StayErrorCode } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid" };
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "token") return { error: "invalid" };
  const token = typeof (body as { token?: unknown }).token === "string" ? (body as { token: string }).token.trim() : "";
  if (!isValidStayTokenFormat(token)) return { error: "invalid" };
  return { token };
}

export function isCanceledReservationStatus(status: string) {
  const value = status.trim().toLowerCase();
  return value === "canceled" || value === "cancelled" || value === "invalid" || value === "void";
}

export function parseClockTime(raw: string): { hours: number; minutes: number } | null {
  const text = raw.trim();
  const ampm = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const mer = ampm[3].toUpperCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) return null;
    if (mer === "PM" && hours < 12) hours += 12;
    if (mer === "AM" && hours === 12) hours = 0;
    if (hours > 23) return null;
    return { hours, minutes };
  }
  const hm = text.match(/^(\d{1,2}):(\d{2})\b/);
  if (!hm) return null;
  const hours = Number(hm[1]);
  const minutes = Number(hm[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

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

export function stayExpiresAt(input: { checkOutDate: string; checkOutTime: string; timeZone?: string }): Date | null {
  const dateMatch = DATE_RE.exec(input.checkOutDate.trim());
  if (!dateMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const clock = parseClockTime(input.checkOutTime) ?? { hours: 23, minutes: 59 };
  const zone = input.timeZone?.trim() || "UTC";
  const expires = zonedLocalToUtc(year, month, day, clock.hours, clock.minutes, zone);
  return Number.isNaN(expires.getTime()) ? null : expires;
}

export function withPropertyStayTimes(
  reservation: StayReservationRecord,
  property: StayPropertyRecord,
): StayReservationRecord {
  return {
    ...reservation,
    check_in_time: reservation.check_in_time.trim() || property.checkInTime?.trim() || "",
    check_out_time: reservation.check_out_time.trim() || property.checkOutTime?.trim() || "",
  };
}

export function publicStayMetadata(input: {
  stayId: string;
  property: StayPropertyRecord;
  reservation: StayReservationRecord;
}): PublicStayMetadata {
  const timed = withPropertyStayTimes(input.reservation, input.property);
  return {
    stayId: input.stayId,
    propertyName: input.property.name.trim(),
    city: input.property.city.trim(),
    checkIn: timed.check_in,
    checkInTime: timed.check_in_time,
    checkOut: timed.check_out,
    checkOutTime: timed.check_out_time,
    status: "active",
  };
}

export function publicStayHasForbiddenFields(payload: unknown) {
  const json = JSON.stringify(payload);
  return FORBIDDEN_PUBLIC_KEYS.some((key) => new RegExp(`"${key}"`, "i").test(json));
}

export function stayJson(data: unknown, status: number) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const STAY_LINKS_GET_BRANCHES = [
  "admin-missing",
  "listings-throw",
  "authorization-error",
  "ownership-unowned",
  "ownership-unavailable",
  "query-error",
  "payload-error",
  "catch",
] as const;

export type StayLinksGetBranch = (typeof STAY_LINKS_GET_BRANCHES)[number];

export type StayLinksSafeDiagnostic = {
  branch: StayLinksGetBranch;
  status: number;
  errorName: string;
  postgrestCode?: string;
};

const STAY_LINKS_DIAG_FORBIDDEN = [
  "propertyId",
  "property_id",
  "reservationId",
  "reservation_id",
  "guest_name",
  "guest",
  "token",
  "address",
  "phone",
  "email",
  "password",
  "access_code",
  "message",
  "stack",
  "details",
  "hint",
  "body",
] as const;

function isStayLinksGetBranch(value: unknown): value is StayLinksGetBranch {
  return typeof value === "string" && (STAY_LINKS_GET_BRANCHES as readonly string[]).includes(value);
}

export function stayLinksSafeErrorName(value: unknown) {
  if (typeof value !== "string") return "Error";
  if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(value)) return "Error";
  const lower = value.toLowerCase();
  if (lower.includes("key") || lower.includes("token") || lower.includes("secret")) return "Error";
  return value;
}

export function stayLinksSafePostgrestCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (/^PGRST\d{3}$/i.test(value)) return value.toUpperCase();
  if (/^(42P01|42703|42501|PGRST116|PGRST204|PGRST205)$/i.test(value)) return value.toUpperCase();
  return undefined;
}

export function extractStayLinksQueryDiagnostic(error: unknown): StayLinksSafeDiagnostic {
  const rec = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const postgrestCode = stayLinksSafePostgrestCode(rec.code);
  const named = stayLinksSafeErrorName(rec.name);
  const errorName = named === "Error" && postgrestCode ? "PostgrestError" : named;
  const diagnostic: StayLinksSafeDiagnostic = {
    branch: "query-error",
    status: 503,
    errorName,
  };
  if (postgrestCode) diagnostic.postgrestCode = postgrestCode;
  return diagnostic;
}

export function sanitizeStayLinksDiagnostic(input: StayLinksSafeDiagnostic): StayLinksSafeDiagnostic {
  const branch = isStayLinksGetBranch(input.branch) ? input.branch : "catch";
  const status = Number.isInteger(input.status) ? input.status : 503;
  const diagnostic: StayLinksSafeDiagnostic = {
    branch,
    status,
    errorName: stayLinksSafeErrorName(input.errorName),
  };
  const code = stayLinksSafePostgrestCode(input.postgrestCode);
  if (code) diagnostic.postgrestCode = code;
  return diagnostic;
}

export function stayLinksFailureLogLine(input: StayLinksSafeDiagnostic) {
  const diagnostic = sanitizeStayLinksDiagnostic(input);
  const parts = [
    "[stay-links-get]",
    `branch=${diagnostic.branch}`,
    `status=${diagnostic.status}`,
    `errorName=${diagnostic.errorName}`,
  ];
  if (diagnostic.postgrestCode) parts.push(`postgrestCode=${diagnostic.postgrestCode}`);
  return parts.join(" ");
}

export const STAY_LINKS_POST_BRANCHES = [
  "reservation-load",
  "canceled",
  "property-load",
  "property-mismatch",
  "expired",
  "revoke-error",
  "insert-error",
  "ownership-unowned",
  "ownership-unavailable",
  "catch",
] as const;

export type StayLinksPostBranch = (typeof STAY_LINKS_POST_BRANCHES)[number];

export type StayLinksPostDiagnostic = {
  branch: StayLinksPostBranch;
  status: number;
  errorName: string;
  postgrestCode?: string;
  foreignKey?: StayLinksForeignKeyCategory;
  createdByMode?: StayLinksCreatedByMode;
};

export const STAY_LINKS_FOREIGN_KEYS = ["created_by", "reservation_id", "property_id", "unknown"] as const;
export type StayLinksForeignKeyCategory = (typeof STAY_LINKS_FOREIGN_KEYS)[number];

export const STAY_LINKS_CREATED_BY_MODES = ["null", "auth-uuid", "invalid"] as const;
export type StayLinksCreatedByMode = (typeof STAY_LINKS_CREATED_BY_MODES)[number];

function isStayLinksPostBranch(value: unknown): value is StayLinksPostBranch {
  return typeof value === "string" && (STAY_LINKS_POST_BRANCHES as readonly string[]).includes(value);
}

function isStayLinksForeignKeyCategory(value: unknown): value is StayLinksForeignKeyCategory {
  return typeof value === "string" && (STAY_LINKS_FOREIGN_KEYS as readonly string[]).includes(value);
}

function isStayLinksCreatedByMode(value: unknown): value is StayLinksCreatedByMode {
  return typeof value === "string" && (STAY_LINKS_CREATED_BY_MODES as readonly string[]).includes(value);
}

const TRUSTED_INSERT_FK_COLUMNS = ["created_by", "reservation_id", "property_id"] as const;

function haystackHasTrustedFk(haystack: string, column: (typeof TRUSTED_INSERT_FK_COLUMNS)[number]) {
  return haystack.includes(`guest_stay_tokens_${column}_fkey`) || haystack.includes(`(${column})`);
}

export function classifyStayTokenInsertForeignKey(error: unknown): StayLinksForeignKeyCategory {
  const rec = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  if (isStayLinksForeignKeyCategory(rec.stayLinksForeignKey) && rec.stayLinksForeignKey !== "unknown") {
    return rec.stayLinksForeignKey;
  }
  if (stayLinksSafeDiagCode(rec.code) !== "23503") return "unknown";
  const haystack = ["message", "details", "hint", "constraint"]
    .map((key) => rec[key])
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const hits = TRUSTED_INSERT_FK_COLUMNS.filter((column) => haystackHasTrustedFk(haystack, column));
  return hits.length === 1 ? hits[0] : "unknown";
}

export function stayLinksSafeDiagCode(value: unknown) {
  const known = stayLinksSafePostgrestCode(value);
  if (known) return known;
  if (typeof value !== "string") return undefined;
  if (!/^[A-Za-z0-9]{3,12}$/.test(value)) return undefined;
  const upper = value.toUpperCase();
  if (upper.includes("KEY") || upper.includes("TOKEN") || upper.includes("SECRET")) return undefined;
  return upper;
}

export function extractStayLinksPostDiagnostic(
  branch: StayLinksPostBranch,
  status: number,
  error?: unknown,
): StayLinksPostDiagnostic {
  const rec = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const postgrestCode = stayLinksSafeDiagCode(rec.code);
  const named = stayLinksSafeErrorName(rec.name);
  const errorName = named === "Error" && postgrestCode ? "PostgrestError" : named;
  const diagnostic: StayLinksPostDiagnostic = { branch, status, errorName };
  if (postgrestCode) diagnostic.postgrestCode = postgrestCode;
  if (branch === "insert-error" && postgrestCode === "23503") {
    diagnostic.foreignKey = classifyStayTokenInsertForeignKey(error);
  }
  return diagnostic;
}

export function sanitizeStayLinksPostDiagnostic(input: StayLinksPostDiagnostic): StayLinksPostDiagnostic {
  const branch = isStayLinksPostBranch(input.branch) ? input.branch : "catch";
  const status = Number.isInteger(input.status) ? input.status : 503;
  const diagnostic: StayLinksPostDiagnostic = {
    branch,
    status,
    errorName: stayLinksSafeErrorName(input.errorName),
  };
  const code = stayLinksSafeDiagCode(input.postgrestCode);
  if (code) diagnostic.postgrestCode = code;
  if (branch === "insert-error" && code === "23503") {
    diagnostic.foreignKey = isStayLinksForeignKeyCategory(input.foreignKey) ? input.foreignKey : "unknown";
  }
  if (branch === "insert-error" && isStayLinksCreatedByMode(input.createdByMode)) {
    diagnostic.createdByMode = input.createdByMode;
  }
  return diagnostic;
}

export function stayLinksPostFailureLogLine(input: StayLinksPostDiagnostic) {
  const diagnostic = sanitizeStayLinksPostDiagnostic(input);
  const parts = [
    "[stay-links-post]",
    `branch=${diagnostic.branch}`,
    `status=${diagnostic.status}`,
    `errorName=${diagnostic.errorName}`,
  ];
  if (diagnostic.postgrestCode) parts.push(`postgrestCode=${diagnostic.postgrestCode}`);
  if (diagnostic.foreignKey) parts.push(`foreignKey=${diagnostic.foreignKey}`);
  if (diagnostic.createdByMode) parts.push(`createdByMode=${diagnostic.createdByMode}`);
  return parts.join(" ");
}

export function stayLinksDiagnosticLooksPrivate(text: string) {
  const lower = text.toLowerCase();
  return STAY_LINKS_DIAG_FORBIDDEN.some((key) => lower.includes(key.replace("_", " ")) || new RegExp(`"${key}"`, "i").test(text));
}

export function logStayLinksGetFailure(input: StayLinksSafeDiagnostic) {
  console.error(stayLinksFailureLogLine(input));
}

export function logStayLinksPostFailure(input: StayLinksPostDiagnostic) {
  console.error(stayLinksPostFailureLogLine(input));
}

function unavailableStoreError(cause?: unknown) {
  const err = new Error("unavailable");
  const code = stayLinksSafeDiagCode(cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined);
  if (code) Object.assign(err, { code });
  if (code === "23503") Object.assign(err, { stayLinksForeignKey: classifyStayTokenInsertForeignKey(cause) });
  return err;
}

function issueStayFailure(
  status: number,
  body: Record<string, unknown>,
  branch: StayLinksPostBranch,
  errorName: string,
  error?: unknown,
  extras?: { createdByMode?: StayLinksCreatedByMode },
): { status: number; body: Record<string, unknown>; diagnostic: StayLinksPostDiagnostic } {
  const extracted = extractStayLinksPostDiagnostic(branch, status, error);
  const name = stayLinksSafeErrorName(errorName);
  return {
    status,
    body,
    diagnostic: sanitizeStayLinksPostDiagnostic({
      ...extracted,
      errorName: name === "Error" ? extracted.errorName : name,
      ...(extras?.createdByMode ? { createdByMode: extras.createdByMode } : {}),
    }),
  };
}

export function authorizeHostStayLink(userId: string | null | undefined, ownedPropertyIds: string[], propertyId: string) {
  return authorizeLocalGuideWrite(userId, ownedPropertyIds, propertyId);
}

function asUuidOrNull(value: string | null | undefined) {
  if (!value || !UUID_RE.test(value)) return null;
  return value;
}

export type StayHostAuthSource = "supabase-auth" | "dev-fallback";

export function stayTokenCreatedBy(userId: string | null | undefined, hostAuthSource?: StayHostAuthSource | null) {
  if (hostAuthSource === "dev-fallback") return null;
  if (hostAuthSource !== "supabase-auth") return null;
  return asUuidOrNull(userId);
}

export function stayTokenCreatedByMode(
  userId: string | null | undefined,
  hostAuthSource?: StayHostAuthSource | null,
): StayLinksCreatedByMode {
  if (hostAuthSource === "dev-fallback") return "null";
  if (hostAuthSource === "supabase-auth") return asUuidOrNull(userId) ? "auth-uuid" : "invalid";
  return "invalid";
}

export async function issueGuestStayLink(input: {
  userId: string | null | undefined;
  hostAuthSource?: StayHostAuthSource | null;
  ownedPropertyIds: string[];
  body: unknown;
  now?: Date;
  store: StayTokenStore;
}): Promise<{ status: number; body: Record<string, unknown>; diagnostic?: StayLinksPostDiagnostic }> {
  const accessUser = input.userId ?? null;
  if (!accessUser) return { status: 401, body: { error: "Unauthorized" } };

  const parsed = parseStayLinkBody(input.body);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };

  let loadedReservation;
  try {
    loadedReservation = await input.store.getReservation(parsed.reservationId);
  } catch (error) {
    return issueStayFailure(503, { error: "unavailable" }, "reservation-load", "Error", error);
  }
  if (!loadedReservation) {
    return issueStayFailure(404, { error: "unavailable" }, "reservation-load", "Error");
  }
  if (isCanceledReservationStatus(loadedReservation.status)) {
    return issueStayFailure(409, { error: "unavailable" }, "canceled", "Canceled");
  }

  let property;
  try {
    property = await input.store.getProperty(loadedReservation.property_id);
  } catch (error) {
    return issueStayFailure(503, { error: "unavailable" }, "property-load", "Error", error);
  }
  if (!property) {
    return issueStayFailure(409, { error: "unavailable" }, "property-load", "PropertyMissing");
  }
  if (property.id !== loadedReservation.property_id) {
    return issueStayFailure(409, { error: "unavailable" }, "property-mismatch", "PropertyMismatch");
  }
  const reservation = withPropertyStayTimes(loadedReservation, property);

  const access = authorizeHostStayLink(accessUser, input.ownedPropertyIds, property.id);
  if (access === "unauthorized") return { status: 401, body: { error: "Unauthorized" } };
  if (access === "forbidden") return { status: 403, body: { error: "forbidden" } };

  const expires = stayExpiresAt({
    checkOutDate: reservation.check_out,
    checkOutTime: reservation.check_out_time,
    timeZone: property.timezone,
  });
  const now = input.now ?? new Date();
  if (!expires || expires.getTime() <= now.getTime()) {
    return issueStayFailure(409, { error: "expired" }, "expired", "Expired");
  }

  const raw = generateStayToken();
  const tokenHash = hashStayToken(raw);
  const createdAt = now.toISOString();
  try {
    await input.store.revokeActiveForReservation(reservation.id, createdAt);
  } catch (error) {
    return issueStayFailure(503, { error: "unavailable" }, "revoke-error", "Error", error);
  }
  let row;
  try {
    row = await input.store.insertToken({
      id: randomUUID(),
      token_hash: tokenHash,
      reservation_id: reservation.id,
      property_id: property.id,
      expires_at: expires.toISOString(),
      revoked_at: null,
      created_at: createdAt,
      created_by: stayTokenCreatedBy(accessUser, input.hostAuthSource),
    });
  } catch (error) {
    return issueStayFailure(503, { error: "unavailable" }, "insert-error", "Error", error, {
      createdByMode: stayTokenCreatedByMode(accessUser, input.hostAuthSource),
    });
  }

  return {
    status: 200,
    body: {
      ok: true,
      token: raw,
      path: `${GUEST_STAY_PUBLIC_PATH_PREFIX}${raw}`,
      expiresAt: row.expires_at,
    },
  };
}

export async function validateGuestStayToken(input: {
  body: unknown;
  now?: Date;
  store: StayTokenStore;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseStayTokenBody(input.body);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };

  const row = await input.store.findByHash(hashStayToken(parsed.token));
  if (!row) return { status: 404, body: { error: "invalid" } };
  if (row.revoked_at) return { status: 410, body: { error: "revoked" } };

  const now = input.now ?? new Date();
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { status: 410, body: { error: "expired" } };

  const loadedReservation = await input.store.getReservation(row.reservation_id);
  if (!loadedReservation) return { status: 404, body: { error: "unavailable" } };
  if (loadedReservation.property_id !== row.property_id) return { status: 409, body: { error: "unavailable" } };
  if (isCanceledReservationStatus(loadedReservation.status)) return { status: 409, body: { error: "unavailable" } };

  const property = await input.store.getProperty(row.property_id);
  if (!property || property.id !== loadedReservation.property_id) return { status: 409, body: { error: "unavailable" } };
  const reservation = withPropertyStayTimes(loadedReservation, property);

  const liveExpires = stayExpiresAt({
    checkOutDate: reservation.check_out,
    checkOutTime: reservation.check_out_time,
    timeZone: property.timezone,
  });
  if (!liveExpires || liveExpires.getTime() <= now.getTime()) return { status: 410, body: { error: "expired" } };

  const payload = publicStayMetadata({ stayId: row.id, property, reservation });
  if (publicStayHasForbiddenFields(payload)) return { status: 500, body: { error: "unavailable" } };
  return { status: 200, body: { ok: true, ...payload } };
}

export function createMemoryStayTokenStore(seed: {
  reservations: StayReservationRecord[];
  properties: StayPropertyRecord[];
  tokens?: GuestStayTokenRow[];
}): StayTokenStore & { tokens: GuestStayTokenRow[] } {
  const reservations = [...seed.reservations];
  const properties = [...seed.properties];
  const tokens = [...(seed.tokens ?? [])];
  return {
    tokens,
    async getReservation(id) {
      return reservations.find((row) => row.id === id) ?? null;
    },
    async getProperty(id) {
      return properties.find((row) => row.id === id) ?? null;
    },
    async listActiveHashes(reservationId) {
      return tokens.filter((row) => row.reservation_id === reservationId && !row.revoked_at).map((row) => row.token_hash);
    },
    async revokeActiveForReservation(reservationId, atIso) {
      for (const row of tokens) {
        if (row.reservation_id === reservationId && !row.revoked_at) row.revoked_at = atIso;
      }
    },
    async insertToken(row) {
      tokens.push({ ...row });
      return { ...row };
    },
    async findByHash(tokenHash) {
      return tokens.find((row) => row.token_hash === tokenHash) ?? null;
    },
  };
}

export function mapStayReservationFromLiveRow(row: Record<string, unknown>): StayReservationRecord | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const propertyId = typeof row.property_id === "string" ? row.property_id.trim() : "";
  if (!id || !propertyId) return null;
  const checkIn = isoDateFromUnknown(row.check_in);
  const checkOut = isoDateFromUnknown(row.check_out);
  if (!checkIn || !checkOut) return null;
  return {
    id,
    property_id: propertyId,
    check_in: checkIn,
    check_in_time: "",
    check_out: checkOut,
    check_out_time: "",
    status: typeof row.status === "string" ? row.status : "",
  };
}

const PROPERTY_QUERY_MASKS = [
  "id, name, city, timezone, check_in, check_out",
  "id, name, city, timezone",
  "id, name, city",
  "id",
] as const;

function isPropertyNoRowError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.toUpperCase() === "PGRST116";
}

function mapPropertyId(value: unknown): string | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return null;
}

function mapProperty(row: Record<string, unknown>): StayPropertyRecord | null {
  const id = mapPropertyId(row.id);
  if (!id) return null;
  return {
    id,
    name: typeof row.name === "string" ? row.name : "",
    city: typeof row.city === "string" ? row.city : "",
    timezone: typeof row.timezone === "string" ? row.timezone.trim() || "UTC" : "UTC",
    checkInTime: typeof row.check_in === "string" ? row.check_in : "",
    checkOutTime: typeof row.check_out === "string" ? row.check_out : "",
  };
}

export async function listEligibleQrStaysForProperty(input: {
  admin: SupabaseClient;
  propertyId: string;
  now?: Date;
}): Promise<{ status: number; body: Record<string, unknown>; diagnostic?: StayLinksSafeDiagnostic }> {
  const { data, error } = await input.admin
    .from("reservations")
    .select(LIVE_RESERVATION_STAY_COLUMNS)
    .eq("property_id", input.propertyId)
    .order("check_in", { ascending: true });
  if (error) {
    return {
      status: 503,
      body: { error: "unavailable" },
      diagnostic: extractStayLinksQueryDiagnostic(error),
    };
  }
  const today = todayIsoDate(input.now);
  const stays = eligibleHostQrStays((data ?? []) as LiveReservationMask[], input.propertyId, today);
  const body = hostQrStaysPayload(stays);
  if (hostQrStayPayloadHasForbiddenFields(body)) {
    return {
      status: 500,
      body: { error: "unavailable" },
      diagnostic: { branch: "payload-error", status: 500, errorName: "PayloadGuard" },
    };
  }
  return { status: 200, body };
}

export function createSupabaseStayTokenStore(admin: SupabaseClient): StayTokenStore {
  return {
    async getReservation(id) {
      const { data, error } = await admin
        .from("reservations")
        .select(LIVE_RESERVATION_STAY_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return mapStayReservationFromLiveRow(data as Record<string, unknown>);
    },
    async getProperty(id) {
      for (let index = 0; index < PROPERTY_QUERY_MASKS.length; index += 1) {
        const mask = PROPERTY_QUERY_MASKS[index];
        const last = index === PROPERTY_QUERY_MASKS.length - 1;
        const result = await admin.from("properties").select(mask).eq("id", id).maybeSingle();
        const row = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? (result.data as Record<string, unknown>) : null;
        const mapped = row ? mapProperty(row) : null;
        if (mapped) return mapped;
        if (last && row) throw unavailableStoreError();
        if (result.error && !isPropertyNoRowError(result.error)) {
          if (last) throw unavailableStoreError(result.error);
          continue;
        }
        if (last) return null;
      }
      return null;
    },
    async listActiveHashes(reservationId) {
      const { data, error } = await admin
        .from("guest_stay_tokens")
        .select("token_hash")
        .eq("reservation_id", reservationId)
        .is("revoked_at", null);
      if (error || !data) return [];
      return data.map((row) => String((row as { token_hash?: string }).token_hash ?? "")).filter(Boolean);
    },
    async revokeActiveForReservation(reservationId, atIso) {
      await admin.from("guest_stay_tokens").update({ revoked_at: atIso }).eq("reservation_id", reservationId).is("revoked_at", null);
    },
    async insertToken(row) {
      const { data, error } = await admin.from("guest_stay_tokens").insert(row).select("id, token_hash, reservation_id, property_id, expires_at, revoked_at, created_at, created_by").single();
      if (error || !data) throw unavailableStoreError(error);
      return data as GuestStayTokenRow;
    },
    async findByHash(tokenHash) {
      const { data, error } = await admin
        .from("guest_stay_tokens")
        .select("id, token_hash, reservation_id, property_id, expires_at, revoked_at, created_at, created_by")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error || !data) return null;
      return data as GuestStayTokenRow;
    },
  };
}

export function guestStayAdminClient() {
  return tryCreateSupabaseAdminClient();
}
