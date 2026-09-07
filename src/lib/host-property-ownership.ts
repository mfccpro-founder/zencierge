import type { SupabaseClient } from "@supabase/supabase-js";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("host-property-ownership is server-only");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Synthetic seed listing IDs from `dashboard-data.ts`.
 * Development fallback may authorize only these IDs, never arbitrary null-host rows.
 */
export const DEV_SYNTHETIC_PROPERTY_IDS = ["prop-1", "prop-2", "prop-3", "prop-4"] as const;

/** Synthetic seed reservation IDs from `dashboard-data.ts`. */
export const DEV_SYNTHETIC_RESERVATION_IDS = [
  "res-elena",
  "res-james",
  "res-marcus",
  "res-sofia",
  "res-lea",
  "res-daniel",
  "res-priya",
] as const;

export type HostOwnershipAuthSource = "supabase-auth" | "dev-fallback";

export type HostOwnershipResult = { kind: "owned" } | { kind: "unowned" } | { kind: "unavailable" };

export type HostOwnershipLookup<T> =
  | { kind: "found"; value: T }
  | { kind: "missing" }
  | { kind: "error" };

export type HostOwnershipStore = {
  lookupPropertyHostId(propertyId: string): Promise<HostOwnershipLookup<string | null>>;
  lookupReservationPropertyId(reservationId: string): Promise<HostOwnershipLookup<string>>;
  listPropertyIdsByHostId(hostId: string): Promise<HostOwnershipLookup<string[]>>;
};

export type HostOwnershipAuth = {
  userId: string | null | undefined;
  source: HostOwnershipAuthSource;
};

export type HostOwnsPropertyInput = {
  propertyId: string;
  auth: HostOwnershipAuth;
  store: HostOwnershipStore;
  nodeEnv?: string;
};

export type HostOwnsReservationInput = {
  reservationId: string;
  propertyId: string;
  auth: HostOwnershipAuth;
  store: HostOwnershipStore;
  nodeEnv?: string;
};

function isNonEmptyId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isHostOwnershipUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isDevSyntheticPropertyId(propertyId: string) {
  return (DEV_SYNTHETIC_PROPERTY_IDS as readonly string[]).includes(propertyId);
}

export function isDevSyntheticReservationId(reservationId: string) {
  return (DEV_SYNTHETIC_RESERVATION_IDS as readonly string[]).includes(reservationId);
}

function resolveNodeEnv(nodeEnv: string | undefined) {
  return nodeEnv ?? process.env.NODE_ENV;
}

function developmentFallbackEnabled(nodeEnv: string | undefined) {
  return resolveNodeEnv(nodeEnv) !== "production";
}

function unowned(): HostOwnershipResult {
  return { kind: "unowned" };
}

function owned(): HostOwnershipResult {
  return { kind: "owned" };
}

function unavailable(): HostOwnershipResult {
  return { kind: "unavailable" };
}

async function realHostOwnsProperty(
  propertyId: string,
  userId: string,
  store: HostOwnershipStore,
): Promise<HostOwnershipResult> {
  let lookup: HostOwnershipLookup<string | null>;
  try {
    lookup = await store.lookupPropertyHostId(propertyId);
  } catch {
    return unavailable();
  }
  if (lookup.kind === "error") return unavailable();
  if (lookup.kind === "missing") return unowned();
  if (lookup.value === null) return unowned();
  if (lookup.value !== userId) return unowned();
  return owned();
}

/**
 * True listing ownership. Never writes. Never uses the anonymous browser client.
 * `host_id` null or a different host is unowned. Query failures are `unavailable`.
 */
export async function hostOwnsProperty(input: HostOwnsPropertyInput): Promise<HostOwnershipResult> {
  if (!isNonEmptyId(input.propertyId)) return unowned();

  if (input.auth.source === "dev-fallback") {
    if (!developmentFallbackEnabled(input.nodeEnv)) return unowned();
    if (isDevSyntheticPropertyId(input.propertyId)) return owned();
    return unowned();
  }

  if (input.auth.source !== "supabase-auth") return unowned();
  if (!isHostOwnershipUuid(input.auth.userId)) return unowned();
  return realHostOwnsProperty(input.propertyId, input.auth.userId, input.store);
}

/**
 * Reservation ownership is derived: reservation.property_id → property.host_id.
 * Caller-supplied propertyId must match the reservation row.
 */
export async function hostOwnsReservation(input: HostOwnsReservationInput): Promise<HostOwnershipResult> {
  if (!isNonEmptyId(input.reservationId) || !isNonEmptyId(input.propertyId)) return unowned();

  if (input.auth.source === "dev-fallback") {
    if (!developmentFallbackEnabled(input.nodeEnv)) return unowned();
  } else if (input.auth.source !== "supabase-auth") {
    return unowned();
  } else if (!isHostOwnershipUuid(input.auth.userId)) {
    return unowned();
  }

  let reservationLookup: HostOwnershipLookup<string>;
  try {
    reservationLookup = await input.store.lookupReservationPropertyId(input.reservationId);
  } catch {
    return unavailable();
  }
  if (reservationLookup.kind === "error") return unavailable();
  if (reservationLookup.kind === "missing") return unowned();
  if (reservationLookup.value !== input.propertyId) return unowned();

  if (input.auth.source === "dev-fallback") {
    if (!isDevSyntheticPropertyId(reservationLookup.value)) return unowned();
    return owned();
  }

  return realHostOwnsProperty(input.propertyId, input.auth.userId as string, input.store);
}

export type HostOwnedPropertyIdsResult = { kind: "ids"; ids: string[] } | { kind: "unavailable" };

export type ListOwnedPropertyIdsInput = {
  auth: HostOwnershipAuth;
  store: HostOwnershipStore;
  nodeEnv?: string;
};

/**
 * Proven owned listing IDs only. Query errors are unavailable, never an empty success.
 * Invalid real auth IDs yield no owned properties.
 */
export async function listOwnedPropertyIds(input: ListOwnedPropertyIdsInput): Promise<HostOwnedPropertyIdsResult> {
  if (input.auth.source === "dev-fallback") {
    if (!developmentFallbackEnabled(input.nodeEnv)) return { kind: "ids", ids: [] };
    return { kind: "ids", ids: [...DEV_SYNTHETIC_PROPERTY_IDS] };
  }

  if (input.auth.source !== "supabase-auth" || !isHostOwnershipUuid(input.auth.userId)) {
    return { kind: "ids", ids: [] };
  }

  let lookup: HostOwnershipLookup<string[]>;
  try {
    lookup = await input.store.listPropertyIdsByHostId(input.auth.userId);
  } catch {
    return { kind: "unavailable" };
  }
  if (lookup.kind === "error") return { kind: "unavailable" };
  if (lookup.kind === "missing") return { kind: "ids", ids: [] };
  return { kind: "ids", ids: lookup.value.filter((id) => isNonEmptyId(id)) };
}

export type StayLinksPostOwnershipGateResult =
  | { kind: "owned"; propertyId: string }
  | { kind: "unowned" }
  | { kind: "unavailable" };

/**
 * POST stay-links gate: reservation.property_id → hostOwnsReservation.
 * Missing/mismatch/other-host/null-host are unowned. Query failures are unavailable.
 */
export async function stayLinksPostOwnershipGate(input: {
  reservationId: string;
  propertyId?: string;
  auth: HostOwnershipAuth;
  store: HostOwnershipStore;
  nodeEnv?: string;
}): Promise<StayLinksPostOwnershipGateResult> {
  if (!isNonEmptyId(input.reservationId)) return { kind: "unowned" };

  let reservationLookup: HostOwnershipLookup<string>;
  try {
    reservationLookup = await input.store.lookupReservationPropertyId(input.reservationId);
  } catch {
    return { kind: "unavailable" };
  }
  if (reservationLookup.kind === "error") return { kind: "unavailable" };
  if (reservationLookup.kind === "missing") return { kind: "unowned" };

  const propertyId = reservationLookup.value;
  if (input.propertyId && input.propertyId !== propertyId) return { kind: "unowned" };

  const result = await hostOwnsReservation({
    reservationId: input.reservationId,
    propertyId,
    auth: input.auth,
    store: input.store,
    nodeEnv: input.nodeEnv,
  });
  if (result.kind === "owned") return { kind: "owned", propertyId };
  return result;
}

export type MemoryHostOwnershipRows = {
  properties?: Record<string, { hostId: string | null }>;
  reservations?: Record<string, { propertyId: string }>;
  failPropertyIds?: ReadonlySet<string>;
  failReservationIds?: ReadonlySet<string>;
  failList?: boolean;
};

/** In-memory store for tests. Read-only. */
export function createMemoryHostOwnershipStore(rows: MemoryHostOwnershipRows = {}): HostOwnershipStore {
  const properties = rows.properties ?? {};
  const reservations = rows.reservations ?? {};
  const failPropertyIds = rows.failPropertyIds ?? new Set<string>();
  const failReservationIds = rows.failReservationIds ?? new Set<string>();
  const failList = rows.failList === true;

  return {
    async lookupPropertyHostId(propertyId) {
      if (failPropertyIds.has(propertyId)) return { kind: "error" };
      if (!Object.prototype.hasOwnProperty.call(properties, propertyId)) return { kind: "missing" };
      return { kind: "found", value: properties[propertyId]!.hostId };
    },
    async lookupReservationPropertyId(reservationId) {
      if (failReservationIds.has(reservationId)) return { kind: "error" };
      if (!Object.prototype.hasOwnProperty.call(reservations, reservationId)) return { kind: "missing" };
      return { kind: "found", value: reservations[reservationId]!.propertyId };
    },
    async listPropertyIdsByHostId(hostId) {
      if (failList) return { kind: "error" };
      const ids = Object.entries(properties)
        .filter(([, row]) => row.hostId === hostId)
        .map(([id]) => id);
      return { kind: "found", value: ids };
    },
  };
}

type PropertyHostRow = { host_id: string | null };
type ReservationPropertyRow = { property_id: string };

/**
 * Service-role lookups only. Select host_id / property_id. Never writes.
 */
export function createSupabaseHostOwnershipStore(client: SupabaseClient): HostOwnershipStore {
  return {
    async lookupPropertyHostId(propertyId) {
      const { data, error } = await client
        .from("properties")
        .select("host_id")
        .eq("id", propertyId)
        .maybeSingle();
      if (error) return { kind: "error" };
      if (!data) return { kind: "missing" };
      const row = data as PropertyHostRow;
      return { kind: "found", value: row.host_id };
    },
    async lookupReservationPropertyId(reservationId) {
      const { data, error } = await client
        .from("reservations")
        .select("property_id")
        .eq("id", reservationId)
        .maybeSingle();
      if (error) return { kind: "error" };
      if (!data) return { kind: "missing" };
      const row = data as ReservationPropertyRow;
      if (typeof row.property_id !== "string" || row.property_id.length === 0) return { kind: "missing" };
      return { kind: "found", value: row.property_id };
    },
    async listPropertyIdsByHostId(hostId) {
      const { data, error } = await client.from("properties").select("id").eq("host_id", hostId);
      if (error) return { kind: "error" };
      const ids = (data ?? [])
        .map((row) => (row as { id?: unknown }).id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      return { kind: "found", value: ids };
    },
  };
}
