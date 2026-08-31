import {
  guestStayFallback,
  properties as seedProperties,
  reservations as seedReservations,
  propertyCities,
  type BookingPlatform,
  type OccupancyStatus,
  type Property,
  type PropertyCity,
  type Reservation,
} from "@/lib/dashboard-data";
import { supabase } from "@/lib/supabase";
import { hasSupabaseEnv } from "@/lib/supabase-config";
import {
  defaultAgentConfig,
  parseAvatarName,
  resolvePropertyForInbound,
  withAgentDefaults,
} from "@/lib/property-agent";

export { guestStayFallback };

const miamiBeachLoft =
  seedProperties.find((property) => property.id === "prop-1") ?? seedProperties[0];

const LISTING_FETCH_MS = 4000;

function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("listing-timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type PropertyRow = {
  id: string;
  name: string;
  city: string;
  address: string;
  status: string;
  revenue: string;
  door_code: string;
  smartlock: string;
  wifi_network: string;
  wifi_password: string;
  parking: string;
  gate_code: string;
  check_in: string;
  check_out: string;
  current_guest: string | null;
  trash?: string;
  handbook?: string;
  ai_handbook?: string;
  assigned_avatar_name?: string;
  assigned_phone_number?: string;
  avatar_system_prompt?: string;
  timezone?: string;
};

export type ReservationRow = {
  id: string;
  property_id: string;
  guest: string;
  phone: string;
  platform: string;
  check_in: string;
  check_out: string;
  check_in_time: string;
  check_out_time: string;
  access_code: string;
  ai_notes: string;
  nights: number;
  status: string;
};

function asCity(value: string): PropertyCity {
  return propertyCities.includes(value as PropertyCity)
    ? (value as PropertyCity)
    : "Miami Beach";
}

function asOccupancy(value: string): OccupancyStatus {
  return value === "Occupied" ? "Occupied" : "Vacant";
}

function asPlatform(value: string): BookingPlatform {
  if (value === "Vrbo" || value === "Direct") return value;
  return "Airbnb";
}

function asStayStatus(value: string): Reservation["status"] {
  if (
    value === "staying" ||
    value === "arriving" ||
    value === "departed" ||
    value === "upcoming"
  ) {
    return value;
  }
  return "upcoming";
}

function fillHouseRulesFromSeed(mapped: Property): Property {
  const seed = seedProperties.find((property) => property.id === mapped.id);
  const index = Math.max(0, seedProperties.findIndex((property) => property.id === mapped.id));
  const defaults = defaultAgentConfig(mapped.city, index);
  const merged: Property = {
    ...mapped,
    trash: mapped.trash.trim() || seed?.trash || "",
    handbook: mapped.handbook.trim() || seed?.handbook || "",
    assignedAvatarName: parseAvatarName(
      mapped.assignedAvatarName || seed?.assignedAvatarName || defaults.assignedAvatarName,
    ),
    assignedPhoneNumber:
      mapped.assignedPhoneNumber?.trim() || seed?.assignedPhoneNumber || defaults.assignedPhoneNumber,
    avatarSystemPrompt:
      mapped.avatarSystemPrompt?.trim() || seed?.avatarSystemPrompt || defaults.avatarSystemPrompt,
    timezone: mapped.timezone?.trim() || seed?.timezone || defaults.timezone,
  };
  return withAgentDefaults(merged, index);
}

export function propertyFromRow(row: PropertyRow): Property {
  return fillHouseRulesFromSeed({
    id: row.id,
    name: row.name ?? "",
    city: asCity(row.city ?? ""),
    address: row.address ?? "",
    status: asOccupancy(row.status ?? ""),
    revenue: row.revenue ?? "$0",
    doorCode: row.door_code ?? "",
    smartlock: row.smartlock ?? "",
    wifiNetwork: row.wifi_network ?? "",
    wifiPassword: row.wifi_password ?? "",
    parking: row.parking ?? "",
    gateCode: row.gate_code ?? "",
    checkIn: row.check_in ?? "",
    checkOut: row.check_out ?? "",
    currentGuest: row.current_guest,
    trash: row.trash ?? "",
    handbook: row.ai_handbook ?? row.handbook ?? "",
    assignedAvatarName: row.assigned_avatar_name ?? "",
    assignedPhoneNumber: row.assigned_phone_number ?? "",
    avatarSystemPrompt: row.avatar_system_prompt ?? "",
    timezone: row.timezone ?? "",
  });
}

export function propertyToRow(property: Property): PropertyRow {
  return {
    id: property.id,
    name: property.name,
    city: property.city,
    address: property.address,
    status: property.status,
    revenue: property.revenue,
    door_code: property.doorCode,
    smartlock: property.smartlock,
    wifi_network: property.wifiNetwork,
    wifi_password: property.wifiPassword,
    parking: property.parking,
    gate_code: property.gateCode,
    check_in: property.checkIn,
    check_out: property.checkOut,
    current_guest: property.currentGuest,
    trash: property.trash,
    ai_handbook: property.handbook,
    assigned_avatar_name: property.assignedAvatarName,
    assigned_phone_number: property.assignedPhoneNumber,
    avatar_system_prompt: property.avatarSystemPrompt,
    timezone: property.timezone,
  };
}

/** True when Supabase rejected a write because the column is not in the schema yet. */
function isMissingColumnError(message: string) {
  return /column|schema cache/i.test(message);
}

/** Row without the house-rules columns, for projects that have not run supabase/schema.sql yet. */
function rowWithoutTrash(row: PropertyRow): PropertyRow {
  const { trash: _trash, ...rest } = row;
  void _trash;
  return rest as PropertyRow;
}

function rowWithoutAgent(row: PropertyRow): PropertyRow {
  const {
    assigned_avatar_name: _avatar,
    assigned_phone_number: _phone,
    avatar_system_prompt: _prompt,
    timezone: _tz,
    ...rest
  } = row;
  void _avatar;
  void _phone;
  void _prompt;
  void _tz;
  return rest as PropertyRow;
}

export function reservationFromRow(row: ReservationRow): Reservation {
  return {
    id: row.id,
    propertyId: row.property_id,
    guest: row.guest,
    phone: row.phone,
    platform: asPlatform(row.platform),
    checkIn: row.check_in,
    checkOut: row.check_out,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    accessCode: row.access_code,
    aiNotes: row.ai_notes,
    nights: row.nights,
    status: asStayStatus(row.status),
  };
}

export function reservationToRow(reservation: Reservation): ReservationRow {
  return {
    id: reservation.id,
    property_id: reservation.propertyId,
    guest: reservation.guest,
    phone: reservation.phone,
    platform: reservation.platform,
    check_in: reservation.checkIn,
    check_out: reservation.checkOut,
    check_in_time: reservation.checkInTime,
    check_out_time: reservation.checkOutTime,
    access_code: reservation.accessCode,
    ai_notes: reservation.aiNotes,
    nights: reservation.nights,
    status: reservation.status,
  };
}

async function selectProperties() {
  return supabase.from("properties").select("*").order("name");
}

async function ensureMiamiBeachLoft() {
  const row = propertyToRow(miamiBeachLoft);
  const full = await supabase.from("properties").upsert(row).select("*");
  if (!full.error && full.data?.length) return full.data as PropertyRow[];

  const withoutTrash = await supabase.from("properties").upsert(rowWithoutTrash(row)).select("*");
  if (!withoutTrash.error && withoutTrash.data?.length) return withoutTrash.data as PropertyRow[];

  const minimal = await supabase
    .from("properties")
    .upsert({
      id: "prop-1",
      name: "Miami Beach Loft",
      city: "Miami Beach",
      ai_handbook: miamiBeachLoft.handbook,
    })
    .select("*");
  if (!minimal.error && minimal.data?.length) return minimal.data as PropertyRow[];

  return [row];
}

export async function fetchListings(): Promise<{
  properties: Property[];
  reservations: Reservation[];
}> {
  if (!hasSupabaseEnv()) {
    console.error(
      "[listings] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local — using seed listings.",
    );
    return { properties: seedProperties, reservations: seedReservations };
  }
  try {
    let propertyRows: PropertyRow[] = [];

    const first = await selectProperties();
    if (first.error || !first.data?.length) {
      propertyRows = await ensureMiamiBeachLoft();
    } else {
      propertyRows = first.data as PropertyRow[];
    }

    const { data: reservationRows } = await supabase
      .from("reservations")
      .select("*")
      .order("check_in");

    const properties = propertyRows.map(propertyFromRow);
    return {
      properties: properties.length ? properties : [miamiBeachLoft],
      reservations: ((reservationRows ?? []) as ReservationRow[]).map(reservationFromRow),
    };
  } catch {
    return { properties: [miamiBeachLoft], reservations: [] };
  }
}

export async function updateAiHandbook(propertyId: string, aiHandbook: string) {
  const patches: Record<string, string>[] = [{ ai_handbook: aiHandbook }, { handbook: aiHandbook }];

  for (const patch of patches) {
    const { data, error } = await supabase
      .from("properties")
      .update(patch)
      .eq("id", propertyId)
      .select("id");

    if (!error && data?.length) return;
    if (error && !/column|schema cache/i.test(error.message)) {
      throw new Error(error.message);
    }
  }

  const base = seedProperties.find((property) => property.id === propertyId) ?? miamiBeachLoft;
  const { error: upsertError, data: upserted } = await supabase
    .from("properties")
    .upsert(propertyToRow({ ...base, id: propertyId, handbook: aiHandbook }))
    .select("id");
  if (upsertError) throw new Error(upsertError.message);
  if (!upserted?.length) {
    throw new Error("No property row was updated. Check the id and RLS policies.");
  }
}

export async function fetchPropertyById(id: string): Promise<Property | null> {
  const seed = seedProperties.find((property) => property.id === id) ?? null;
  if (!hasSupabaseEnv()) return seed;

  const { signal, cancel } = abortAfter(LISTING_FETCH_MS);
  try {
    const query = supabase
      .from("properties")
      .select("*")
      .eq("id", id)
      .abortSignal(signal)
      .maybeSingle();
    const { data, error } = await raceTimeout(Promise.resolve(query), LISTING_FETCH_MS);
    if (!error && data) return propertyFromRow(data as PropertyRow);
  } catch (cause) {
    console.error("[listings] fetchPropertyById timed out or failed; using seed", cause);
  } finally {
    cancel();
  }
  return seed;
}

/** Guest portal: seed immediately if Supabase is slow, missing, or unknown id. */
export async function fetchGuestStay(id: string): Promise<Property> {
  try {
    const row = await fetchPropertyById(id);
    if (row) return row;
  } catch (cause) {
    console.error("[listings] fetchGuestStay failed; using Miami Beach Loft seed", cause);
  }
  return guestStayFallback(id);
}

export async function fetchReservationById(id: string): Promise<Reservation | null> {
  if (hasSupabaseEnv()) {
    const { data, error } = await supabase.from("reservations").select("*").eq("id", id).maybeSingle();
    if (!error && data) return reservationFromRow(data as ReservationRow);
  }
  return seedReservations.find((reservation) => reservation.id === id) ?? null;
}

export async function upsertProperty(property: Property) {
  const row = propertyToRow(property);
  const attempts = [
    row,
    rowWithoutAgent(row),
    rowWithoutTrash(row),
    rowWithoutTrash(rowWithoutAgent(row)),
  ];
  let lastMessage = "";
  for (const attempt of attempts) {
    const { error } = await supabase.from("properties").upsert(attempt);
    if (!error) return;
    lastMessage = error.message;
    if (!isMissingColumnError(error.message)) throw new Error(error.message);
  }
  throw new Error(lastMessage || "Could not save property");
}

export async function loadInboundProperty(input: {
  property?: Property | null;
  propertyId?: string | null;
  to?: string | null;
  calledNumber?: string | null;
}): Promise<Property | null> {
  const { properties } = await fetchListings();
  const dialed = (input.to ?? input.calledNumber ?? "").trim();
  if (dialed) {
    return resolvePropertyForInbound(properties, {
      to: input.to,
      calledNumber: input.calledNumber,
    });
  }
  const propertyId = (input.propertyId ?? input.property?.id ?? "").trim();
  if (propertyId) {
    const live = resolvePropertyForInbound(properties, { propertyId });
    if (live) {
      if (input.property?.name && input.property.id === live.id) {
        return withAgentDefaults(
          {
            ...live,
            ...input.property,
            assignedAvatarName: live.assignedAvatarName,
            assignedPhoneNumber: live.assignedPhoneNumber,
            avatarSystemPrompt: live.avatarSystemPrompt,
            timezone: live.timezone,
            handbook: input.property.handbook?.trim() || live.handbook,
          },
          properties.findIndex((item) => item.id === live.id),
        );
      }
      return live;
    }
  }
  if (input.property?.name && input.property.city) {
    const index = Math.max(
      0,
      properties.findIndex((item) => item.id === input.property?.id),
    );
    return withAgentDefaults(input.property, index);
  }
  return resolvePropertyForInbound(properties, {});
}

export async function upsertReservation(reservation: Reservation) {
  const { error } = await supabase.from("reservations").upsert(reservationToRow(reservation));
  if (error) throw new Error(error.message);
}
