import {
  properties as seedProperties,
  type BookingPlatform,
  type OccupancyStatus,
  type Property,
  type PropertyCity,
  type Reservation,
} from "@/lib/dashboard-data";
import { defaultAgentConfig, parseAvatarName, withAgentDefaults } from "@/lib/property-agent";

// Mapping only. Database reads and writes belong in server-only modules.

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
  host_id?: string | null;
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
  return value.trim();
}

function asOccupancy(value: string): OccupancyStatus {
  return value === "Occupied" ? "Occupied" : "Vacant";
}

function asPlatform(value: string): BookingPlatform {
  return value === "Vrbo" || value === "Direct" ? value : "Airbnb";
}

function asStayStatus(value: string): Reservation["status"] {
  return value === "staying" || value === "arriving" || value === "departed" || value === "upcoming"
    ? value
    : "upcoming";
}

function fillHouseRulesFromSeed(mapped: Property): Property {
  const seed = seedProperties.find((property) => property.id === mapped.id);
  const index = Math.max(0, seedProperties.findIndex((property) => property.id === mapped.id));
  const defaults = defaultAgentConfig(mapped.city, index);
  return withAgentDefaults({
    ...mapped,
    trash: mapped.trash.trim() || seed?.trash || "",
    handbook: mapped.handbook.trim() || seed?.handbook || "",
    assignedAvatarName: parseAvatarName(mapped.assignedAvatarName || seed?.assignedAvatarName || defaults.assignedAvatarName),
    assignedPhoneNumber: mapped.assignedPhoneNumber?.trim() || seed?.assignedPhoneNumber || defaults.assignedPhoneNumber,
    avatarSystemPrompt: mapped.avatarSystemPrompt?.trim() || seed?.avatarSystemPrompt || defaults.avatarSystemPrompt,
    timezone: mapped.timezone?.trim() || seed?.timezone || defaults.timezone,
  }, index);
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
