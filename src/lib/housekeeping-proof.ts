import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RESERVATION_STAY_COLUMNS, isoDateFromUnknown } from "@/lib/guest-stay-qr";
import { housekeepingProofNow, HOUSEKEEPING_PROOF_STAGE_WINDOW_MS, rematerializeHousekeepingProofDemoExpiresAt } from "@/lib/housekeeping-proof-clock";
import {
  createSupabaseHostOwnershipStore,
  isHostOwnershipUuid,
  stayLinksPostOwnershipGate,
  type HostOwnershipAuthSource,
  type HostOwnershipStore,
} from "@/lib/host-property-ownership";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("housekeeping-proof is server-only");
}

export const HOUSEKEEPING_PROOF_TOKEN_BYTES = 32;
export const HOUSEKEEPING_PROOF_PATH_PREFIX = "/housekeeping/p/";
export const HOUSEKEEPING_PROOF_RPC = "issue_housekeeping_proof_link_atomic";
export const HOUSEKEEPING_PROOF_MAX_BODY_BYTES = 2048;
export const HOUSEKEEPING_PROOF_ISSUE_RATE_MAX = 40;
export const HOUSEKEEPING_PROOF_VALIDATE_RATE_MAX = 20;
export const HOUSEKEEPING_PROOF_RATE_WINDOW_MS = 60_000;
export const HOUSEKEEPING_PROOF_RESERVATION_COLUMNS = LIVE_RESERVATION_STAY_COLUMNS;
export const HOUSEKEEPING_PROOF_PROPERTY_WINDOW_COLUMNS = "id, timezone, check_in, check_out";
export const HOUSEKEEPING_PROOF_PROPERTY_PUBLIC_COLUMNS = "name, city";
export const HOUSEKEEPING_PROOF_TOKEN_LOOKUP_COLUMNS = "task_id, expires_at, revoked_at";
export const HOUSEKEEPING_PROOF_TASK_LOOKUP_COLUMNS = "id, property_id, stage, status, due_at";

const TOKEN_CHARSET = /^[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;

export type HousekeepingProofError = "invalid" | "expired" | "revoked" | "unavailable";
export type HousekeepingProofStage = "post_checkout" | "ready_for_checkin";
export type HousekeepingProofPublicStatus = "open" | "submitted" | "needs_attention";
export type HousekeepingProofRateMap = Map<string, number[]>;

export class HousekeepingProofIssueRpcError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "HousekeepingProofIssueRpcError";
    this.code = code;
  }
}

export function mapHousekeepingProofIssueRpcCode(code: string | undefined): { status: number; body: Record<string, unknown> } {
  if (code === "ZP004") return { status: 409, body: { error: "submitted" } };
  return err(503, "unavailable");
}

export type HousekeepingProofReservation = {
  id: string;
  property_id: string;
  check_in: string;
  check_out: string;
  status: string;
};

export type HousekeepingProofPropertyWindow = {
  id: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string;
};

export type HousekeepingProofTokenLookup = {
  task_id: string;
  expires_at: string;
  revoked_at: string | null;
};

export type HousekeepingProofTaskLookup = {
  id: string;
  property_id: string;
  stage: string;
  status: string;
  due_at: string | null;
};

export type HousekeepingProofPropertyPublic = {
  name: string;
  city: string;
};

export type HousekeepingProofAtomicArgs = {
  propertyId: string;
  reservationId: string;
  stage: HousekeepingProofStage;
  dueAt: string;
  expiresAt: string;
  tokenHash: string;
  createdBy: string | null;
};

export type HousekeepingProofStore = {
  getReservation(id: string): Promise<HousekeepingProofReservation | null>;
  getPropertyWindow(id: string): Promise<HousekeepingProofPropertyWindow | null>;
  issueAtomic(args: HousekeepingProofAtomicArgs): Promise<{ task_id: string; expires_at: string }>;
  findTokenByHash(tokenHash: string): Promise<HousekeepingProofTokenLookup | null>;
  getTask(id: string): Promise<HousekeepingProofTaskLookup | null>;
  countPendingPhotos(taskId: string): Promise<number>;
  getPropertyPublic(id: string): Promise<HousekeepingProofPropertyPublic | null>;
};

const issueRateHits: HousekeepingProofRateMap = new Map();
const validateRateHits: HousekeepingProofRateMap = new Map();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStage(value: unknown): value is HousekeepingProofStage {
  return value === "post_checkout" || value === "ready_for_checkin";
}

function isPublicStatus(value: unknown): value is HousekeepingProofPublicStatus {
  return value === "open" || value === "submitted" || value === "needs_attention";
}

function isCanceledReservationStatus(status: string) {
  const value = status.trim().toLowerCase();
  return value === "canceled" || value === "cancelled" || value === "invalid" || value === "void";
}

function err(status: number, error: HousekeepingProofError) {
  return { status, body: { error } as Record<string, unknown> };
}

export function housekeepingProofJson(data: unknown, status: number) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function housekeepingProofBodyTooLarge(contentLength: string | null, body?: unknown) {
  if (contentLength) {
    const size = Number(contentLength);
    if (!Number.isFinite(size) || size > HOUSEKEEPING_PROOF_MAX_BODY_BYTES) return true;
  }
  if (body !== undefined) {
    try {
      return Buffer.byteLength(JSON.stringify(body), "utf8") > HOUSEKEEPING_PROOF_MAX_BODY_BYTES;
    } catch {
      return true;
    }
  }
  return false;
}

export function generateHousekeepingProofToken() {
  return randomBytes(HOUSEKEEPING_PROOF_TOKEN_BYTES).toString("base64url");
}

export function hashHousekeepingProofToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidHousekeepingProofTokenFormat(token: unknown): token is string {
  if (typeof token !== "string") return false;
  if (!TOKEN_CHARSET.test(token)) return false;
  if (token.length < 43 || token.length > 64) return false;
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const bytes = Buffer.from(`${padded}${pad}`, "base64");
    return bytes.length >= HOUSEKEEPING_PROOF_TOKEN_BYTES;
  } catch {
    return false;
  }
}

export function parseHousekeepingProofLinkBody(
  body: unknown,
): { reservationId: string; stage: HousekeepingProofStage } | { error: HousekeepingProofError } {
  if (!isPlainObject(body)) return { error: "invalid" };
  const keys = Object.keys(body);
  if (keys.length !== 2) return { error: "invalid" };
  if (!keys.includes("reservationId") || !keys.includes("stage")) return { error: "invalid" };
  const reservationId = typeof body.reservationId === "string" ? body.reservationId.trim() : "";
  if (!reservationId || reservationId.length > 80) return { error: "invalid" };
  if (!isStage(body.stage)) return { error: "invalid" };
  return { reservationId, stage: body.stage };
}

export function parseHousekeepingProofTokenBody(body: unknown): { token: string } | { error: HousekeepingProofError } {
  if (!isPlainObject(body)) return { error: "invalid" };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "token") return { error: "invalid" };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!isValidHousekeepingProofTokenFormat(token)) return { error: "invalid" };
  return { token };
}

export function housekeepingProofCreatedBy(
  userId: string | null | undefined,
  hostAuthSource?: HostOwnershipAuthSource | null,
) {
  if (hostAuthSource === "dev-fallback") return null;
  if (hostAuthSource !== "supabase-auth") return null;
  if (!isHostOwnershipUuid(userId)) return null;
  return userId;
}

export function housekeepingProofClientIp(headers: { get(name: string): string | null }) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}

export function housekeepingProofRateLimited(
  map: HousekeepingProofRateMap,
  key: string,
  max: number,
  windowMs = HOUSEKEEPING_PROOF_RATE_WINDOW_MS,
) {
  const now = Date.now();
  const recent = (map.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    map.set(key, recent);
    return true;
  }
  recent.push(now);
  map.set(key, recent);
  if (map.size > 500) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  return false;
}

export function housekeepingProofIssueRateKey(userId: string, ip: string) {
  return `issue:user:${userId}:ip:${ip}`;
}

export function housekeepingProofValidateRateKey(ip: string, tokenHash: string) {
  return `validate:ip:${ip}:hash:${tokenHash}`;
}

function parseClockTime(raw: string): { hours: number; minutes: number } | null {
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

export function housekeepingProofBoundaryAt(input: { date: string; time: string; timeZone: string }): Date | null {
  const zone = input.timeZone.trim();
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
  } catch {
    return null;
  }
  const dateMatch = DATE_RE.exec(input.date.trim());
  if (!dateMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const clock = parseClockTime(input.time) ?? { hours: 23, minutes: 59 };
  const boundary = zonedLocalToUtc(year, month, day, clock.hours, clock.minutes, zone);
  return Number.isNaN(boundary.getTime()) ? null : boundary;
}

export function housekeepingProofWindows(input: {
  stage: HousekeepingProofStage;
  reservation: HousekeepingProofReservation;
  property: HousekeepingProofPropertyWindow;
}): { dueAt: Date; expiresAt: Date } | null {
  const checkInTime = input.property.checkInTime.trim();
  const checkOutTime = input.property.checkOutTime.trim();
  if (input.stage === "post_checkout") {
    const dueAt = housekeepingProofBoundaryAt({
      date: input.reservation.check_out,
      time: checkOutTime,
      timeZone: input.property.timezone,
    });
    if (!dueAt) return null;
    return {
      dueAt,
      expiresAt: new Date(dueAt.getTime() + HOUSEKEEPING_PROOF_STAGE_WINDOW_MS.post_checkout),
    };
  }
  const dueAt = housekeepingProofBoundaryAt({
    date: input.reservation.check_in,
    time: checkInTime,
    timeZone: input.property.timezone,
  });
  if (!dueAt) return null;
  return {
    dueAt,
    expiresAt: new Date(dueAt.getTime() + HOUSEKEEPING_PROOF_STAGE_WINDOW_MS.ready_for_checkin),
  };
}

export function parseHousekeepingProofAtomicResult(data: unknown): { task_id: string; expires_at: string } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!isPlainObject(row)) return null;
  const taskId = typeof row.task_id === "string" ? row.task_id.trim() : "";
  if (!UUID_RE.test(taskId)) return null;
  let expiresAt = "";
  if (typeof row.expires_at === "string") expiresAt = row.expires_at;
  else if (row.expires_at instanceof Date && !Number.isNaN(row.expires_at.getTime())) expiresAt = row.expires_at.toISOString();
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  return { task_id: taskId, expires_at: expiresAt };
}

export async function issueHousekeepingProofLink(input: {
  userId: string | null | undefined;
  hostAuthSource: HostOwnershipAuthSource | null;
  body: unknown;
  ip: string;
  now?: Date;
  store: HousekeepingProofStore;
  ownershipStore: HostOwnershipStore;
  nodeEnv?: string;
  issueRateMap?: HousekeepingProofRateMap;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.userId) return { status: 401, body: { error: "invalid" } };
  if (input.hostAuthSource !== "supabase-auth" && input.hostAuthSource !== "dev-fallback") {
    return { status: 401, body: { error: "invalid" } };
  }

  const parsed = parseHousekeepingProofLinkBody(input.body);
  if ("error" in parsed) return err(400, parsed.error);

  const rateKey = housekeepingProofIssueRateKey(input.userId, input.ip || "local");
  if (
    housekeepingProofRateLimited(
      input.issueRateMap ?? issueRateHits,
      rateKey,
      HOUSEKEEPING_PROOF_ISSUE_RATE_MAX,
    )
  ) {
    return err(429, "unavailable");
  }

  let ownedPropertyId: string;
  try {
    const gate = await stayLinksPostOwnershipGate({
      reservationId: parsed.reservationId,
      auth: { userId: input.userId, source: input.hostAuthSource },
      store: input.ownershipStore,
      nodeEnv: input.nodeEnv,
    });
    if (gate.kind === "unowned") return err(403, "unavailable");
    if (gate.kind === "unavailable") return err(503, "unavailable");
    ownedPropertyId = gate.propertyId;
  } catch {
    return err(503, "unavailable");
  }

  let reservation: HousekeepingProofReservation | null;
  try {
    reservation = await input.store.getReservation(parsed.reservationId);
  } catch {
    return err(503, "unavailable");
  }
  if (!reservation) return err(409, "unavailable");
  if (reservation.property_id !== ownedPropertyId) return err(403, "unavailable");
  if (isCanceledReservationStatus(reservation.status)) return err(409, "unavailable");

  let property: HousekeepingProofPropertyWindow | null;
  try {
    property = await input.store.getPropertyWindow(ownedPropertyId);
  } catch {
    return err(503, "unavailable");
  }
  if (!property || property.id !== ownedPropertyId) return err(409, "unavailable");

  const windows = housekeepingProofWindows({ stage: parsed.stage, reservation, property });
  const hasExplicitNow = input.now !== undefined;
  const now =
    input.now ??
    housekeepingProofNow({
      nodeEnv: input.nodeEnv,
      timeZone: property.timezone,
    });
  if (!windows || windows.expiresAt.getTime() <= now.getTime()) return err(409, "unavailable");

  const expiresAt = rematerializeHousekeepingProofDemoExpiresAt({
    stage: parsed.stage,
    expiresAt: windows.expiresAt,
    nodeEnv: input.nodeEnv,
    hasExplicitNow,
  });

  const raw = generateHousekeepingProofToken();
  const tokenHash = hashHousekeepingProofToken(raw);
  const createdBy = housekeepingProofCreatedBy(input.userId, input.hostAuthSource);

  let issued: { task_id: string; expires_at: string };
  try {
    issued = await input.store.issueAtomic({
      propertyId: ownedPropertyId,
      reservationId: reservation.id,
      stage: parsed.stage,
      dueAt: windows.dueAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      tokenHash,
      createdBy,
    });
  } catch (error) {
    if (error instanceof HousekeepingProofIssueRpcError) {
      return mapHousekeepingProofIssueRpcCode(error.code);
    }
    return err(503, "unavailable");
  }

  const parsedRpc = parseHousekeepingProofAtomicResult(issued);
  if (!parsedRpc) return err(503, "unavailable");

  return {
    status: 200,
    body: {
      ok: true,
      path: `${HOUSEKEEPING_PROOF_PATH_PREFIX}${raw}`,
      expiresAt: parsedRpc.expires_at,
    },
  };
}

export async function validateHousekeepingProofToken(input: {
  body: unknown;
  ip: string;
  now?: Date;
  nodeEnv?: string;
  timeZone?: string;
  store: HousekeepingProofStore;
  validateRateMap?: HousekeepingProofRateMap;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseHousekeepingProofTokenBody(input.body);
  if ("error" in parsed) return err(400, parsed.error);

  const tokenHash = hashHousekeepingProofToken(parsed.token);
  const rateKey = housekeepingProofValidateRateKey(input.ip || "local", tokenHash);
  if (
    housekeepingProofRateLimited(
      input.validateRateMap ?? validateRateHits,
      rateKey,
      HOUSEKEEPING_PROOF_VALIDATE_RATE_MAX,
    )
  ) {
    return err(429, "unavailable");
  }

  let tokenRow: HousekeepingProofTokenLookup | null;
  try {
    tokenRow = await input.store.findTokenByHash(tokenHash);
  } catch {
    return err(503, "unavailable");
  }
  if (!tokenRow) return err(404, "invalid");
  if (tokenRow.revoked_at) return err(410, "revoked");

  const now =
    input.now ??
    housekeepingProofNow({
      nodeEnv: input.nodeEnv,
      timeZone: input.timeZone,
    });
  if (Number.isNaN(Date.parse(tokenRow.expires_at)) || new Date(tokenRow.expires_at).getTime() <= now.getTime()) {
    return err(410, "expired");
  }

  let task: HousekeepingProofTaskLookup | null;
  try {
    task = await input.store.getTask(tokenRow.task_id);
  } catch {
    return err(503, "unavailable");
  }
  if (!task) return err(409, "unavailable");
  if (task.status === "approved") {
    return { status: 200, body: { ok: true, status: "approved" } };
  }
  if (!isStage(task.stage) || !isPublicStatus(task.status)) return err(409, "unavailable");

  let pendingCount: number;
  try {
    pendingCount = await input.store.countPendingPhotos(task.id);
  } catch {
    return err(503, "unavailable");
  }
  if (!Number.isInteger(pendingCount) || pendingCount < 0) return err(503, "unavailable");
  const hasPendingPhotos = pendingCount > 0;

  let property: HousekeepingProofPropertyPublic | null;
  try {
    property = await input.store.getPropertyPublic(task.property_id);
  } catch {
    return err(503, "unavailable");
  }
  if (!property) return err(409, "unavailable");

  const dueAt = task.due_at && !Number.isNaN(Date.parse(task.due_at)) ? new Date(task.due_at).toISOString() : null;
  if (!dueAt) return err(409, "unavailable");

  return {
    status: 200,
    body: {
      ok: true,
      propertyName: property.name.trim(),
      city: property.city.trim(),
      stage: task.stage,
      dueAt,
      status: task.status,
      hasPendingPhotos,
    },
  };
}

export type MemoryHousekeepingProofToken = HousekeepingProofTokenLookup & { token_hash: string };

export type MemoryHousekeepingProofRows = {
  reservations?: HousekeepingProofReservation[];
  properties?: Array<HousekeepingProofPropertyWindow & HousekeepingProofPropertyPublic & { id: string }>;
  tokens?: MemoryHousekeepingProofToken[];
  tasks?: HousekeepingProofTaskLookup[];
  pendingPhotos?: Array<{ task_id: string; review_status?: "pending" | "approved" | "rejected" }>;
  failReservationIds?: ReadonlySet<string>;
  failPropertyIds?: ReadonlySet<string>;
  failPendingCountIds?: ReadonlySet<string>;
  failRpc?: boolean;
  failRpcCode?: string;
  rpcResult?: { task_id: string; expires_at: string };
};

export function createMemoryHousekeepingProofStore(rows: MemoryHousekeepingProofRows = {}) {
  const reservations = [...(rows.reservations ?? [])];
  const properties = [...(rows.properties ?? [])];
  const tokens = [...(rows.tokens ?? [])];
  const tasks = [...(rows.tasks ?? [])];
  const pendingPhotos = [...(rows.pendingPhotos ?? [])];
  const rpcCalls: HousekeepingProofAtomicArgs[] = [];
  const failReservationIds = rows.failReservationIds ?? new Set<string>();
  const failPropertyIds = rows.failPropertyIds ?? new Set<string>();
  const failPendingCountIds = rows.failPendingCountIds ?? new Set<string>();

  const store: HousekeepingProofStore & { rpcCalls: HousekeepingProofAtomicArgs[]; tokens: MemoryHousekeepingProofToken[] } = {
    rpcCalls,
    tokens,
    async getReservation(id) {
      if (failReservationIds.has(id)) throw new Error("unavailable");
      return reservations.find((row) => row.id === id) ?? null;
    },
    async getPropertyWindow(id) {
      if (failPropertyIds.has(id)) throw new Error("unavailable");
      const row = properties.find((item) => item.id === id);
      if (!row) return null;
      return {
        id: row.id,
        timezone: row.timezone,
        checkInTime: row.checkInTime,
        checkOutTime: row.checkOutTime,
      };
    },
    async issueAtomic(args) {
      rpcCalls.push({ ...args });
      if (rows.failRpc) throw new Error("unavailable");
      if (rows.failRpcCode) throw new HousekeepingProofIssueRpcError(rows.failRpcCode);
      if (!TOKEN_HASH_RE.test(args.tokenHash)) throw new Error("unavailable");
      return (
        rows.rpcResult ?? {
          task_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          expires_at: args.expiresAt,
        }
      );
    },
    async findTokenByHash(tokenHash) {
      const row = tokens.find((item) => item.token_hash === tokenHash);
      if (!row) return null;
      return { task_id: row.task_id, expires_at: row.expires_at, revoked_at: row.revoked_at };
    },
    async getTask(id) {
      return tasks.find((row) => row.id === id) ?? null;
    },
    async countPendingPhotos(taskId) {
      if (failPendingCountIds.has(taskId)) throw new Error("unavailable");
      return pendingPhotos.filter(
        (row) => row.task_id === taskId && (row.review_status ?? "pending") === "pending",
      ).length;
    },
    async getPropertyPublic(id) {
      const row = properties.find((item) => item.id === id);
      if (!row) return null;
      return { name: row.name, city: row.city };
    },
  };

  return store;
}

function mapReservation(row: Record<string, unknown>): HousekeepingProofReservation | null {
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
    check_out: checkOut,
    status: typeof row.status === "string" ? row.status : "",
  };
}

function mapPropertyWindow(row: Record<string, unknown>): HousekeepingProofPropertyWindow | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  const timezone = typeof row.timezone === "string" ? row.timezone.trim() : "";
  return {
    id,
    timezone,
    checkInTime: typeof row.check_in === "string" ? row.check_in : "",
    checkOutTime: typeof row.check_out === "string" ? row.check_out : "",
  };
}

export function createSupabaseHousekeepingProofStore(admin: SupabaseClient): HousekeepingProofStore {
  return {
    async getReservation(id) {
      const { data, error } = await admin
        .from("reservations")
        .select(HOUSEKEEPING_PROOF_RESERVATION_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return mapReservation(data as Record<string, unknown>);
    },
    async getPropertyWindow(id) {
      const { data, error } = await admin
        .from("properties")
        .select(HOUSEKEEPING_PROOF_PROPERTY_WINDOW_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return mapPropertyWindow(data as Record<string, unknown>);
    },
    async issueAtomic(args) {
      const { data, error } = await admin.rpc(HOUSEKEEPING_PROOF_RPC, {
        p_property_id: args.propertyId,
        p_reservation_id: args.reservationId,
        p_stage: args.stage,
        p_due_at: args.dueAt,
        p_expires_at: args.expiresAt,
        p_token_hash: args.tokenHash,
        p_created_by: args.createdBy,
      });
      if (error) {
        const code = typeof error.code === "string" && error.code ? error.code : "unknown";
        throw new HousekeepingProofIssueRpcError(code);
      }
      const parsed = parseHousekeepingProofAtomicResult(data);
      if (!parsed) throw new Error("unavailable");
      return parsed;
    },
    async findTokenByHash(tokenHash) {
      const { data, error } = await admin
        .from("housekeeping_proof_tokens")
        .select(HOUSEKEEPING_PROOF_TOKEN_LOOKUP_COLUMNS)
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      const taskId = typeof row.task_id === "string" ? row.task_id : "";
      const expiresAt = typeof row.expires_at === "string" ? row.expires_at : "";
      if (!taskId || !expiresAt) return null;
      return {
        task_id: taskId,
        expires_at: expiresAt,
        revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null,
      };
    },
    async getTask(id) {
      const { data, error } = await admin
        .from("housekeeping_proof_tasks")
        .select(HOUSEKEEPING_PROOF_TASK_LOOKUP_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      const taskId = typeof row.id === "string" ? row.id : "";
      const propertyId = typeof row.property_id === "string" ? row.property_id : "";
      if (!taskId || !propertyId) return null;
      return {
        id: taskId,
        property_id: propertyId,
        stage: typeof row.stage === "string" ? row.stage : "",
        status: typeof row.status === "string" ? row.status : "",
        due_at: typeof row.due_at === "string" ? row.due_at : null,
      };
    },
    async countPendingPhotos(taskId) {
      const { count, error } = await admin
        .from("housekeeping_proof_photos")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId)
        .eq("review_status", "pending");
      if (error) throw new Error("unavailable");
      return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0;
    },
    async getPropertyPublic(id) {
      const { data, error } = await admin
        .from("properties")
        .select(HOUSEKEEPING_PROOF_PROPERTY_PUBLIC_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      return {
        name: typeof row.name === "string" ? row.name : "",
        city: typeof row.city === "string" ? row.city : "",
      };
    },
  };
}

export function housekeepingProofAdminClient() {
  return tryCreateSupabaseAdminClient();
}

export function housekeepingProofOwnershipStore(admin: SupabaseClient) {
  return createSupabaseHostOwnershipStore(admin);
}
