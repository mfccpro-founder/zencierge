import "server-only";

export const NEARBY_PLACE_KINDS = [
  "restaurant",
  "pharmacy",
  "grocery",
  "hospital",
  "gas",
  "nearby",
] as const;

export type NearbyPlaceKind = (typeof NEARBY_PLACE_KINDS)[number];

export type NearbyPlaceResult = {
  name: string;
  mapsUri: string;
};

export type NearbyFailCode = "key" | "quota" | "timeout" | "geocode" | "google" | "auth";

export class NearbyUnavailableError extends Error {
  readonly code: NearbyFailCode;
  constructor(code: NearbyFailCode) {
    super("unavailable");
    this.name = "NearbyUnavailableError";
    this.code = code;
  }
}

type LatLng = { lat: number; lng: number };

const GOOGLE_TIMEOUT_MS = 4000;
const COORD_TTL_MS = 24 * 60 * 60 * 1000;
const COORD_CACHE_MAX = 100;
const METERS_PER_MILE = 1609.344;

const SEARCH_RADIUS_MILES: Record<NearbyPlaceKind, number> = {
  restaurant: 3,
  pharmacy: 3,
  grocery: 3,
  nearby: 3,
  gas: 5,
  hospital: 10,
};

const PLACE_TYPES: Record<NearbyPlaceKind, string[]> = {
  restaurant: ["restaurant"],
  pharmacy: ["pharmacy"],
  grocery: ["supermarket"],
  hospital: ["hospital"],
  gas: ["gas_station"],
  nearby: ["restaurant", "cafe", "supermarket"],
};

const coordCache = new Map<string, { value: LatLng; exp: number }>();

export function isNearbyPlaceKind(value: string): value is NearbyPlaceKind {
  return (NEARBY_PLACE_KINDS as readonly string[]).includes(value);
}

export function nearbySearchRadiusMeters(kind: NearbyPlaceKind) {
  return SEARCH_RADIUS_MILES[kind] * METERS_PER_MILE;
}

function googleKey() {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() ?? "";
}

function cacheGet<T>(map: Map<string, { value: T; exp: number }>, key: string) {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(
  map: Map<string, { value: T; exp: number }>,
  key: string,
  value: T,
  ttlMs: number,
  max: number,
) {
  if (map.has(key)) map.delete(key);
  map.set(key, { value, exp: Date.now() + ttlMs });
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

async function fetchGoogle(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (cause) {
    const aborted =
      (cause instanceof Error && cause.name === "AbortError") || controller.signal.aborted;
    throw new NearbyUnavailableError(aborted ? "timeout" : "google");
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeListing(propertyId: string, city: string, address: string): Promise<LatLng> {
  const cached = cacheGet(coordCache, propertyId);
  if (cached) return cached;

  const key = googleKey();
  if (!key) throw new NearbyUnavailableError("key");

  const query = [address.trim(), city.trim()].filter(Boolean).join(", ");
  if (!query) throw new NearbyUnavailableError("geocode");

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);

  const response = await fetchGoogle(url.toString(), { method: "GET" });
  if (!response.ok) await failFromGoogleResponse(response, "geocode");

  const payload = (await response.json()) as {
    status?: string;
    results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
  };
  if (payload.status === "REQUEST_DENIED") throw new NearbyUnavailableError("auth");
  if (payload.status === "OVER_QUERY_LIMIT") throw new NearbyUnavailableError("quota");
  const loc = payload.results?.[0]?.geometry?.location;
  const lat = loc?.lat;
  const lng = loc?.lng;
  if (payload.status !== "OK" || typeof lat !== "number" || typeof lng !== "number") {
    throw new NearbyUnavailableError("geocode");
  }

  const coords = { lat, lng };
  cacheSet(coordCache, propertyId, coords, COORD_TTL_MS, COORD_CACHE_MAX);
  return coords;
}

function failFromHttp(status: number, fallback: NearbyFailCode): NearbyFailCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "quota";
  return fallback;
}

async function failFromGoogleResponse(response: Response, fallback: NearbyFailCode): Promise<never> {
  let code = failFromHttp(response.status, fallback);
  try {
    const payload = (await response.json()) as { error?: { status?: string }; status?: string };
    const status = payload.error?.status || payload.status;
    if (status === "PERMISSION_DENIED" || status === "UNAUTHENTICATED" || status === "REQUEST_DENIED") {
      code = "auth";
    } else if (status === "RESOURCE_EXHAUSTED" || status === "OVER_QUERY_LIMIT") {
      code = "quota";
    }
  } catch {
    // Ignore Google error bodies; never log them.
  }
  throw new NearbyUnavailableError(code);
}

function sanitizePlaceName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function searchNearbyPlaces(input: {
  propertyId: string;
  city: string;
  address: string;
  kind: NearbyPlaceKind;
  language: "en" | "es";
}): Promise<NearbyPlaceResult[]> {
  const key = googleKey();
  if (!key) throw new NearbyUnavailableError("key");

  const origin = await geocodeListing(input.propertyId, input.city, input.address);
  const includedTypes = PLACE_TYPES[input.kind];

  const response = await fetchGoogle("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.googleMapsUri",
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 3,
      rankPreference: "DISTANCE",
      languageCode: input.language === "es" ? "es" : "en",
      locationRestriction: {
        circle: {
          center: { latitude: origin.lat, longitude: origin.lng },
          radius: nearbySearchRadiusMeters(input.kind),
        },
      },
    }),
  });

  if (!response.ok) await failFromGoogleResponse(response, "google");

  const payload = (await response.json()) as {
    places?: Array<{
      displayName?: { text?: string };
      googleMapsUri?: string;
    }>;
  };

  const results: NearbyPlaceResult[] = [];
  for (const place of payload.places ?? []) {
    const name = sanitizePlaceName(place.displayName?.text ?? "");
    const mapsUri = place.googleMapsUri?.trim() ?? "";
    if (!name || !mapsUri.startsWith("https://")) continue;
    results.push({ name, mapsUri: mapsUri.slice(0, 500) });
    if (results.length >= 3) break;
  }

  return results;
}
