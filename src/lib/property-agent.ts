import type { Property } from "@/lib/dashboard-data";
import type { VoiceProfileId } from "@/lib/human-voice";

export const PROPERTY_AVATAR_NAMES = ["Elena", "Austin", "Sofia", "Mateo", "Sarah"] as const;
export type PropertyAvatarName = (typeof PROPERTY_AVATAR_NAMES)[number];

export const PROPERTY_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

export type PropertyAgentConfig = {
  assignedAvatarName: PropertyAvatarName;
  assignedPhoneNumber: string;
  avatarSystemPrompt: string;
  timezone: string;
};

const FLORIDA_TONE =
  "Local tone: South Florida short-term rental. Quiet hours, HOA rules, hurricane-season common sense. Never invent codes. America/New_York for guest-facing times unless the listing timezone says otherwise.";

const TEXAS_TONE =
  "Local tone: Texas short-term rental. America/Chicago for guest-facing times. Be warm and direct. Never invent door codes or HOA exceptions.";

export function defaultTimezoneForCity(city: string) {
  const value = city.toLowerCase();
  if (value.includes("austin") || value.includes("dallas") || value.includes("houston") || value.includes("texas")) {
    return "America/Chicago";
  }
  return "America/New_York";
}

export function defaultAvatarSystemPrompt(city: string) {
  return defaultTimezoneForCity(city) === "America/Chicago" ? TEXAS_TONE : FLORIDA_TONE;
}

export function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export function phonesMatch(a: string, b: string) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export function parseAvatarName(value: string | null | undefined): PropertyAvatarName {
  const raw = (value ?? "").trim().toLowerCase();
  const hit = PROPERTY_AVATAR_NAMES.find((name) => name.toLowerCase() === raw);
  return hit ?? "Elena";
}

export function voiceIdFromAvatarName(name: string): VoiceProfileId {
  const parsed = parseAvatarName(name);
  if (parsed === "Austin") return "austin";
  if (parsed === "Sofia") return "sofia";
  if (parsed === "Mateo") return "mateo";
  if (parsed === "Sarah") return "sarah";
  return "elena";
}

export function avatarNameFromVoiceId(id: VoiceProfileId): PropertyAvatarName {
  if (id === "austin") return "Austin";
  if (id === "sofia") return "Sofia";
  if (id === "mateo") return "Mateo";
  if (id === "sarah") return "Sarah";
  return "Elena";
}

export function defaultAgentConfig(city: string, index = 0): PropertyAgentConfig {
  const avatars: PropertyAvatarName[] = ["Elena", "Sofia", "Austin", "Elena"];
  const phones = ["+1 (305) 555-0199", "+1 (305) 555-0188", "+1 (954) 555-0144", "+1 (305) 555-0177"];
  return {
    assignedAvatarName: avatars[index % avatars.length] ?? "Elena",
    assignedPhoneNumber: phones[index % phones.length] ?? "+1 (305) 555-0199",
    avatarSystemPrompt: defaultAvatarSystemPrompt(city),
    timezone: defaultTimezoneForCity(city),
  };
}

export function withAgentDefaults(property: Property, index = 0): Property {
  const fallback = defaultAgentConfig(property.city, index);
  return {
    ...property,
    assignedAvatarName: parseAvatarName(property.assignedAvatarName || fallback.assignedAvatarName),
    assignedPhoneNumber: property.assignedPhoneNumber?.trim() || fallback.assignedPhoneNumber,
    avatarSystemPrompt: property.avatarSystemPrompt?.trim() || fallback.avatarSystemPrompt,
    timezone: property.timezone?.trim() || fallback.timezone,
  };
}

export function resolvePropertyForInbound(
  listings: Property[],
  input: { propertyId?: string | null; to?: string | null; calledNumber?: string | null },
) {
  const id = (input.propertyId ?? "").trim();
  if (id) {
    const byId = listings.find((item) => item.id === id);
    if (byId) return withAgentDefaults(byId, listings.indexOf(byId));
    return null;
  }
  const dialed = (input.to ?? input.calledNumber ?? "").trim();
  if (dialed) {
    const byPhone = listings.find((item) => phonesMatch(item.assignedPhoneNumber, dialed));
    if (byPhone) return withAgentDefaults(byPhone, listings.indexOf(byPhone));
    return null;
  }
  const first = listings[0];
  return first ? withAgentDefaults(first, 0) : null;
}

export function localTimeLabel(timezone: string, at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(at);
  } catch {
    return at.toLocaleString("en-US");
  }
}
