import {
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

const miamiBeachLoft =
  seedProperties.find((property) => property.id === "prop-1") ?? seedProperties[0];

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
  handbook?: string;
  ai_handbook?: string;
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

export function propertyFromRow(row: PropertyRow): Property {
  return {
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
    handbook: row.ai_handbook ?? row.handbook ?? "",
  };
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
    ai_handbook: property.handbook,
  };
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
  const { data, error } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
  if (!error && data) return propertyFromRow(data as PropertyRow);
  return seedProperties.find((property) => property.id === id) ?? null;
}

export async function fetchReservationById(id: string): Promise<Reservation | null> {
  const { data, error } = await supabase.from("reservations").select("*").eq("id", id).maybeSingle();
  if (!error && data) return reservationFromRow(data as ReservationRow);
  return seedReservations.find((reservation) => reservation.id === id) ?? null;
}

export async function upsertProperty(property: Property) {
  const { error } = await supabase.from("properties").upsert(propertyToRow(property));
  if (error) throw new Error(error.message);
}

export async function upsertReservation(reservation: Reservation) {
  const { error } = await supabase.from("reservations").upsert(reservationToRow(reservation));
  if (error) throw new Error(error.message);
}
