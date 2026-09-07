import type { SupabaseClient } from "@supabase/supabase-js";
import { housekeepingProofNow } from "@/lib/housekeeping-proof-clock";
import {
  housekeepingProofWindows,
  type HousekeepingProofPropertyWindow,
  type HousekeepingProofReservation,
  type HousekeepingProofStage,
} from "@/lib/housekeeping-proof";
import {
  listOwnedPropertyIds,
  type HostOwnershipAuthSource,
  type HostOwnershipStore,
} from "@/lib/host-property-ownership";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("housekeeping-proof-options is server-only");
}

export const HOUSEKEEPING_PROOF_OPTIONS_PROPERTY_COLUMNS = "id, name, timezone, check_in, check_out" as const;
export const HOUSEKEEPING_PROOF_OPTIONS_RESERVATION_COLUMNS = "id, property_id, check_in, check_out, status" as const;
export const HOUSEKEEPING_PROOF_OPTIONS_MAX_PROPERTIES = 80;
export const HOUSEKEEPING_PROOF_OPTIONS_MAX_RESERVATIONS = 300;
export const HOUSEKEEPING_PROOF_OPTIONS_STAGES = ["post_checkout", "ready_for_checkin"] as const;

export type HousekeepingProofOptionsProperty = { id: string; name: string };
export type HousekeepingProofOptionsReservation = {
  id: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  status: string;
  eligibleStages: HousekeepingProofStage[];
};

export type HousekeepingProofOptionsBody = {
  ok: true;
  properties: HousekeepingProofOptionsProperty[];
  reservations: HousekeepingProofOptionsReservation[];
  /** Count of (reservation, stage) pairs with pending host-review photos. */
  pendingHousekeepingCount: number;
};

export type HousekeepingProofOptionsPropertyRow = HousekeepingProofPropertyWindow & {
  name: string;
};

export type HousekeepingProofOptionsLookup<T> =
  | { kind: "rows"; rows: T[] }
  | { kind: "error" }
  | { kind: "truncated" };

export const HOUSEKEEPING_PROOF_OPTIONS_REVIEWABLE_TASK_STATUSES = ["open", "submitted", "needs_attention"] as const;
export const HOUSEKEEPING_PROOF_OPTIONS_TERMINAL_TASK_STATUSES = ["approved", "closed"] as const;
export const HOUSEKEEPING_PROOF_OPTIONS_PENDING_PHOTO_STATUS = "pending" as const;
export const HOUSEKEEPING_PROOF_OPTIONS_TASK_COLUMNS = "id, property_id, reservation_id, stage, status" as const;
export const HOUSEKEEPING_PROOF_OPTIONS_PENDING_PHOTO_COLUMNS = "task_id" as const;

export type HousekeepingProofOptionsPendingStage = {
  reservationId: string;
  propertyId: string;
  stage: HousekeepingProofStage;
};

export type HousekeepingProofOptionsStore = {
  listProperties(ids: readonly string[]): Promise<HousekeepingProofOptionsLookup<HousekeepingProofOptionsPropertyRow>>;
  listReservations(propertyIds: readonly string[]): Promise<HousekeepingProofOptionsLookup<HousekeepingProofReservation>>;
  listPendingReviewStages(input: {
    propertyIds: readonly string[];
    reservationIds: readonly string[];
  }): Promise<HousekeepingProofOptionsLookup<HousekeepingProofOptionsPendingStage>>;
  listTerminalIssueStages(input: {
    propertyIds: readonly string[];
    reservationIds: readonly string[];
  }): Promise<HousekeepingProofOptionsLookup<HousekeepingProofOptionsPendingStage>>;
};

function isCanceledReservationStatus(status: string) {
  const value = status.trim().toLowerCase();
  return value === "canceled" || value === "cancelled" || value === "invalid" || value === "void";
}

function isoDateFromUnknown(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? "";
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

export function housekeepingProofOptionsClockIsConfigured(time: string) {
  return parseClockTime(time) !== null;
}

export function housekeepingProofOptionsTimeZoneIsConfigured(timeZone: string) {
  const zone = timeZone.trim();
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function housekeepingProofOptionsEligibleStages(
  reservation: HousekeepingProofReservation,
  property: HousekeepingProofPropertyWindow,
  now: Date,
): HousekeepingProofStage[] {
  if (!housekeepingProofOptionsTimeZoneIsConfigured(property.timezone)) return [];
  if (!housekeepingProofOptionsClockIsConfigured(property.checkInTime)) return [];
  if (!housekeepingProofOptionsClockIsConfigured(property.checkOutTime)) return [];
  const stages: HousekeepingProofStage[] = [];
  for (const stage of HOUSEKEEPING_PROOF_OPTIONS_STAGES) {
    const windows = housekeepingProofWindows({ stage, reservation, property });
    if (windows && windows.expiresAt.getTime() > now.getTime()) stages.push(stage);
  }
  return stages;
}

function isOptionsStage(value: string): value is HousekeepingProofStage {
  return (HOUSEKEEPING_PROOF_OPTIONS_STAGES as readonly string[]).includes(value);
}

function isReviewableTaskStatus(status: string) {
  return (HOUSEKEEPING_PROOF_OPTIONS_REVIEWABLE_TASK_STATUSES as readonly string[]).includes(status);
}

function isTerminalTaskStatus(status: string) {
  return (HOUSEKEEPING_PROOF_OPTIONS_TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

function mergeEligibleStages(windowed: HousekeepingProofStage[], pending: readonly HousekeepingProofStage[]) {
  const extra = new Set(pending);
  return HOUSEKEEPING_PROOF_OPTIONS_STAGES.filter((stage) => windowed.includes(stage) || extra.has(stage));
}

function withoutTerminalStages(eligible: HousekeepingProofStage[], blocked: readonly HousekeepingProofStage[]) {
  const deny = new Set(blocked);
  return eligible.filter((stage) => !deny.has(stage));
}

function sortProperties(rows: HousekeepingProofOptionsProperty[]) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
}

function sortReservations(rows: HousekeepingProofOptionsReservation[]) {
  return [...rows].sort(
    (a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut) || a.id.localeCompare(b.id),
  );
}

function emptyOk(): { status: 200; body: HousekeepingProofOptionsBody } {
  return { status: 200, body: { ok: true, properties: [], reservations: [], pendingHousekeepingCount: 0 } };
}

function unavailable(): { status: 503; body: { error: "unavailable" } } {
  return { status: 503, body: { error: "unavailable" } };
}

function unauthorized(): { status: 401; body: { error: "Unauthorized" } } {
  return { status: 401, body: { error: "Unauthorized" } };
}

export async function listHousekeepingProofOptions(input: {
  userId: string | null | undefined;
  hostAuthSource: HostOwnershipAuthSource | null;
  ownershipStore: HostOwnershipStore;
  store: HousekeepingProofOptionsStore;
  now?: Date;
  nodeEnv?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.userId) return unauthorized();
  if (input.hostAuthSource !== "supabase-auth" && input.hostAuthSource !== "dev-fallback") {
    return unauthorized();
  }

  let ownedIds: string[];
  try {
    const listed = await listOwnedPropertyIds({
      auth: { userId: input.userId, source: input.hostAuthSource },
      store: input.ownershipStore,
      nodeEnv: input.nodeEnv,
    });
    if (listed.kind === "unavailable") return unavailable();
    ownedIds = listed.ids.filter((id) => typeof id === "string" && id.trim().length > 0);
  } catch {
    return unavailable();
  }

  if (ownedIds.length === 0) return emptyOk();
  if (ownedIds.length > HOUSEKEEPING_PROOF_OPTIONS_MAX_PROPERTIES) return unavailable();

  const ownedSet = new Set(ownedIds);
  let propertyRows: HousekeepingProofOptionsPropertyRow[];
  try {
    const listed = await input.store.listProperties(ownedIds);
    if (listed.kind === "error" || listed.kind === "truncated") return unavailable();
    propertyRows = listed.rows.filter((row) => ownedSet.has(row.id));
  } catch {
    return unavailable();
  }

  const properties = sortProperties(
    propertyRows
      .map((row) => {
        const name = row.name.trim();
        if (!name) return null;
        return { id: row.id, name };
      })
      .filter((row): row is HousekeepingProofOptionsProperty => row !== null),
  );
  const windowById = new Map(propertyRows.map((row) => [row.id, row]));

  let reservationRows: HousekeepingProofReservation[];
  try {
    const listed = await input.store.listReservations(ownedIds);
    if (listed.kind === "error" || listed.kind === "truncated") return unavailable();
    reservationRows = listed.rows.filter((row) => ownedSet.has(row.property_id));
  } catch {
    return unavailable();
  }

  const activeReservations = reservationRows.filter((row) => !isCanceledReservationStatus(row.status));
  const pendingByReservation = new Map<string, HousekeepingProofStage[]>();
  try {
    const listed = await input.store.listPendingReviewStages({
      propertyIds: ownedIds,
      reservationIds: activeReservations.map((row) => row.id),
    });
    if (listed.kind === "error" || listed.kind === "truncated") return unavailable();
    const reservationProperty = new Map(activeReservations.map((row) => [row.id, row.property_id]));
    for (const row of listed.rows) {
      if (!ownedSet.has(row.propertyId)) continue;
      if (reservationProperty.get(row.reservationId) !== row.propertyId) continue;
      if (!isOptionsStage(row.stage)) continue;
      const current = pendingByReservation.get(row.reservationId) ?? [];
      if (!current.includes(row.stage)) current.push(row.stage);
      pendingByReservation.set(row.reservationId, current);
    }
  } catch {
    return unavailable();
  }

  const terminalByReservation = new Map<string, HousekeepingProofStage[]>();
  try {
    const listed = await input.store.listTerminalIssueStages({
      propertyIds: ownedIds,
      reservationIds: activeReservations.map((row) => row.id),
    });
    if (listed.kind === "error" || listed.kind === "truncated") return unavailable();
    const reservationProperty = new Map(activeReservations.map((row) => [row.id, row.property_id]));
    for (const row of listed.rows) {
      if (!ownedSet.has(row.propertyId)) continue;
      if (reservationProperty.get(row.reservationId) !== row.propertyId) continue;
      if (!isOptionsStage(row.stage)) continue;
      const current = terminalByReservation.get(row.reservationId) ?? [];
      if (!current.includes(row.stage)) current.push(row.stage);
      terminalByReservation.set(row.reservationId, current);
    }
  } catch {
    return unavailable();
  }

  const reservations = sortReservations(
    activeReservations.flatMap((row) => {
      const property = windowById.get(row.property_id);
      if (!property) return [];
      const now =
        input.now ??
        housekeepingProofNow({
          nodeEnv: input.nodeEnv,
          timeZone: property.timezone,
        });
      const eligibleStages = withoutTerminalStages(
        mergeEligibleStages(
          housekeepingProofOptionsEligibleStages(row, property, now),
          pendingByReservation.get(row.id) ?? [],
        ),
        terminalByReservation.get(row.id) ?? [],
      );
      if (!eligibleStages.length) return [];
      return [
        {
          id: row.id,
          propertyId: row.property_id,
          checkIn: row.check_in,
          checkOut: row.check_out,
          status: row.status,
          eligibleStages,
        },
      ];
    }),
  );

  let pendingHousekeepingCount = 0;
  for (const stages of pendingByReservation.values()) {
    pendingHousekeepingCount += stages.length;
  }

  return {
    status: 200,
    body: { ok: true, properties, reservations, pendingHousekeepingCount },
  };
}

export function createMemoryHousekeepingProofOptionsStore(input: {
  properties?: HousekeepingProofOptionsPropertyRow[];
  reservations?: HousekeepingProofReservation[];
  pending?: Array<HousekeepingProofOptionsPendingStage & { status?: string; pendingPhotoCount?: number }>;
  terminal?: Array<HousekeepingProofOptionsPendingStage & { status?: string }>;
  failProperties?: boolean;
  failReservations?: boolean;
  failPending?: boolean;
  failTerminal?: boolean;
  throwTerminal?: boolean;
  truncateProperties?: boolean;
  truncateReservations?: boolean;
} = {}): HousekeepingProofOptionsStore {
  const properties = [...(input.properties ?? [])];
  const reservations = [...(input.reservations ?? [])];
  const pending = [...(input.pending ?? [])];
  const terminal = [...(input.terminal ?? [])];
  return {
    async listProperties(ids) {
      if (input.failProperties) return { kind: "error" };
      if (input.truncateProperties) return { kind: "truncated" };
      const allow = new Set(ids);
      return { kind: "rows", rows: properties.filter((row) => allow.has(row.id)) };
    },
    async listReservations(propertyIds) {
      if (input.failReservations) return { kind: "error" };
      if (input.truncateReservations) return { kind: "truncated" };
      const allow = new Set(propertyIds);
      return { kind: "rows", rows: reservations.filter((row) => allow.has(row.property_id)) };
    },
    async listPendingReviewStages({ propertyIds, reservationIds }) {
      if (input.failPending) return { kind: "error" };
      const propertiesAllow = new Set(propertyIds);
      const reservationsAllow = new Set(reservationIds);
      const rows: HousekeepingProofOptionsPendingStage[] = [];
      for (const row of pending) {
        if (!propertiesAllow.has(row.propertyId) || !reservationsAllow.has(row.reservationId)) continue;
        if (!isOptionsStage(row.stage)) continue;
        if (!isReviewableTaskStatus(row.status ?? "open")) continue;
        if ((row.pendingPhotoCount ?? 1) < 1) continue;
        rows.push({ reservationId: row.reservationId, propertyId: row.propertyId, stage: row.stage });
      }
      return { kind: "rows", rows };
    },
    async listTerminalIssueStages({ propertyIds, reservationIds }) {
      if (input.throwTerminal) throw new Error("unavailable");
      if (input.failTerminal) return { kind: "error" };
      const propertiesAllow = new Set(propertyIds);
      const reservationsAllow = new Set(reservationIds);
      const rows: HousekeepingProofOptionsPendingStage[] = [];
      for (const row of terminal) {
        if (!propertiesAllow.has(row.propertyId) || !reservationsAllow.has(row.reservationId)) continue;
        if (!isOptionsStage(row.stage)) continue;
        if (!isTerminalTaskStatus(row.status ?? "")) continue;
        rows.push({ reservationId: row.reservationId, propertyId: row.propertyId, stage: row.stage });
      }
      return { kind: "rows", rows };
    },
  };
}

function mapPropertyRow(row: Record<string, unknown>): HousekeepingProofOptionsPropertyRow | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name : "";
  if (!id) return null;
  return {
    id,
    name,
    timezone: typeof row.timezone === "string" ? row.timezone.trim() : "",
    checkInTime: typeof row.check_in === "string" ? row.check_in : "",
    checkOutTime: typeof row.check_out === "string" ? row.check_out : "",
  };
}

function mapReservationRow(row: Record<string, unknown>): HousekeepingProofReservation | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const propertyId = typeof row.property_id === "string" ? row.property_id.trim() : "";
  const checkIn = isoDateFromUnknown(row.check_in);
  const checkOut = isoDateFromUnknown(row.check_out);
  if (!id || !propertyId || !checkIn || !checkOut) return null;
  return {
    id,
    property_id: propertyId,
    check_in: checkIn,
    check_out: checkOut,
    status: typeof row.status === "string" ? row.status : "",
  };
}

type PendingTaskRow = {
  id: string;
  propertyId: string;
  reservationId: string;
  stage: HousekeepingProofStage;
};

function mapPendingTask(row: Record<string, unknown>): PendingTaskRow | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const propertyId = typeof row.property_id === "string" ? row.property_id.trim() : "";
  const reservationId = typeof row.reservation_id === "string" ? row.reservation_id.trim() : "";
  const stage = typeof row.stage === "string" ? row.stage : "";
  const status = typeof row.status === "string" ? row.status : "";
  if (!id || !propertyId || !reservationId || !isOptionsStage(stage) || !isReviewableTaskStatus(status)) return null;
  return { id, propertyId, reservationId, stage };
}

function mapTerminalStage(row: Record<string, unknown>): HousekeepingProofOptionsPendingStage | null {
  const propertyId = typeof row.property_id === "string" ? row.property_id.trim() : "";
  const reservationId = typeof row.reservation_id === "string" ? row.reservation_id.trim() : "";
  const stage = typeof row.stage === "string" ? row.stage : "";
  const status = typeof row.status === "string" ? row.status : "";
  if (!propertyId || !reservationId || !isOptionsStage(stage) || !isTerminalTaskStatus(status)) return null;
  return { propertyId, reservationId, stage };
}

export function createSupabaseHousekeepingProofOptionsStore(admin: SupabaseClient): HousekeepingProofOptionsStore {
  return {
    async listProperties(ids) {
      if (ids.length === 0) return { kind: "rows", rows: [] };
      const { data, error } = await admin
        .from("properties")
        .select(HOUSEKEEPING_PROOF_OPTIONS_PROPERTY_COLUMNS)
        .in("id", [...ids]);
      if (error) return { kind: "error" };
      const rows = (data ?? [])
        .map((row) => mapPropertyRow(row as Record<string, unknown>))
        .filter((row): row is HousekeepingProofOptionsPropertyRow => row !== null);
      return { kind: "rows", rows };
    },
    async listReservations(propertyIds) {
      if (propertyIds.length === 0) return { kind: "rows", rows: [] };
      const { data, error } = await admin
        .from("reservations")
        .select(HOUSEKEEPING_PROOF_OPTIONS_RESERVATION_COLUMNS)
        .in("property_id", [...propertyIds])
        .limit(HOUSEKEEPING_PROOF_OPTIONS_MAX_RESERVATIONS + 1);
      if (error) return { kind: "error" };
      const rows = (data ?? [])
        .map((row) => mapReservationRow(row as Record<string, unknown>))
        .filter((row): row is HousekeepingProofReservation => row !== null);
      if (rows.length > HOUSEKEEPING_PROOF_OPTIONS_MAX_RESERVATIONS) return { kind: "truncated" };
      return { kind: "rows", rows };
    },
    async listPendingReviewStages({ propertyIds, reservationIds }) {
      if (propertyIds.length === 0 || reservationIds.length === 0) return { kind: "rows", rows: [] };
      const ownedProperties = new Set(propertyIds);
      const ownedReservations = new Set(reservationIds);
      const { data: taskData, error: taskError } = await admin
        .from("housekeeping_proof_tasks")
        .select(HOUSEKEEPING_PROOF_OPTIONS_TASK_COLUMNS)
        .in("property_id", [...propertyIds])
        .in("reservation_id", [...reservationIds])
        .in("status", [...HOUSEKEEPING_PROOF_OPTIONS_REVIEWABLE_TASK_STATUSES]);
      if (taskError) return { kind: "error" };
      const tasks = (taskData ?? [])
        .map((row) => mapPendingTask(row as Record<string, unknown>))
        .filter((row): row is PendingTaskRow => row !== null)
        .filter((row) => ownedProperties.has(row.propertyId) && ownedReservations.has(row.reservationId));
      if (tasks.length === 0) return { kind: "rows", rows: [] };
      const { data: photoData, error: photoError } = await admin
        .from("housekeeping_proof_photos")
        .select(HOUSEKEEPING_PROOF_OPTIONS_PENDING_PHOTO_COLUMNS)
        .in("task_id", tasks.map((row) => row.id))
        .eq("review_status", HOUSEKEEPING_PROOF_OPTIONS_PENDING_PHOTO_STATUS);
      if (photoError) return { kind: "error" };
      const pendingTaskIds = new Set(
        (photoData ?? [])
          .map((row) => (row as Record<string, unknown>).task_id)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      );
      const rows: HousekeepingProofOptionsPendingStage[] = [];
      for (const task of tasks) {
        if (!pendingTaskIds.has(task.id)) continue;
        rows.push({ reservationId: task.reservationId, propertyId: task.propertyId, stage: task.stage });
      }
      return { kind: "rows", rows };
    },
    async listTerminalIssueStages({ propertyIds, reservationIds }) {
      if (propertyIds.length === 0 || reservationIds.length === 0) return { kind: "rows", rows: [] };
      const ownedProperties = new Set(propertyIds);
      const ownedReservations = new Set(reservationIds);
      const { data, error } = await admin
        .from("housekeeping_proof_tasks")
        .select(HOUSEKEEPING_PROOF_OPTIONS_TASK_COLUMNS)
        .in("property_id", [...propertyIds])
        .in("reservation_id", [...reservationIds])
        .in("status", [...HOUSEKEEPING_PROOF_OPTIONS_TERMINAL_TASK_STATUSES]);
      if (error) return { kind: "error" };
      const rows = (data ?? [])
        .map((row) => mapTerminalStage(row as Record<string, unknown>))
        .filter((row): row is HousekeepingProofOptionsPendingStage => row !== null)
        .filter((row) => ownedProperties.has(row.propertyId) && ownedReservations.has(row.reservationId));
      return { kind: "rows", rows };
    },
  };
}
