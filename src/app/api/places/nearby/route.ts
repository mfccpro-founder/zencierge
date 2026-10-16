import { NextRequest } from "next/server";
import { requireHostUser } from "@/lib/supabase-route";
import { loadHostListings } from "@/lib/host-listings-server";
import {
  isNearbyPlaceKind,
  NearbyUnavailableError,
  searchNearbyPlaces,
} from "@/lib/places-nearby";
import { loadActiveLocalGuide } from "@/lib/local-guide";
import { nearbyFromHostOrGoogle } from "@/lib/local-guide-shared";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { authorizeGuestProperty } from "@/lib/guest-property-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const rateHits = new Map<string, number[]>();

function clientKey(request: NextRequest, userId?: string) {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${forwarded || "local"}`;
}

function rateLimited(key: string) {
  const now = Date.now();
  const recent = (rateHits.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    rateHits.set(key, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(key, recent);
  if (rateHits.size > 500) {
    const oldest = rateHits.keys().next().value;
    if (oldest) rateHits.delete(oldest);
  }
  return false;
}

function unavailable(code: string = "google") {
  return Response.json({ error: "unavailable", code }, { status: 503 });
}

export async function POST(request: NextRequest) {
  let body: { propertyId?: string; kind?: string; language?: string; token?: string };
  try {
    body = (await request.json()) as { propertyId?: string; kind?: string; language?: string };
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const allowedKeys = new Set(["propertyId", "kind", "language", "token"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const propertyId = typeof body.propertyId === "string" ? body.propertyId.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  const language = body.language === "es" ? "es" : body.language === "en" || body.language === undefined ? "en" : "";
  if (!propertyId || propertyId.length > 80 || !isNearbyPlaceKind(kind) || (language !== "en" && language !== "es")) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const admin = tryCreateSupabaseAdminClient();
    if (!admin) return unavailable("database");
    let listing;
    let rateKey: string;
    if (Object.hasOwn(body, "token")) {
      const guest = await authorizeGuestProperty({ admin, token: body.token, requestedPropertyId: propertyId });
      if (guest.kind === "rejected") return Response.json({ error: guest.error }, { status: guest.status });
      listing = guest.property;
      rateKey = clientKey(request);
    } else {
      const auth = await requireHostUser();
      if (auth.error) return auth.error;
      const owned = await loadHostListings(admin, auth.user.id);
      if (owned.kind === "unavailable") return unavailable("database");
      listing = owned.properties.find((candidate) => candidate.id === propertyId) ?? null;
      rateKey = clientKey(request, auth.user.id);
    }
    if (rateLimited(rateKey)) return Response.json({ error: "unavailable", code: "quota" }, { status: 429 });
    if (!listing?.id || listing.id !== propertyId || !listing.city) return unavailable("geocode");

    const hostResults = await loadActiveLocalGuide(listing.id, kind, admin);
    const nearby = nearbyFromHostOrGoogle(hostResults);
    if (nearby.source === "host") {
      return Response.json({
        source: "host",
        hostResults: nearby.hostResults,
      });
    }

    const results = await searchNearbyPlaces({
      propertyId: listing.id,
      city: listing.city,
      address: listing.address,
      kind,
      language,
    });

    return Response.json({
      source: "google",
      results: results.slice(0, 3).map((item) => ({
        name: item.name,
        mapsUri: item.mapsUri,
      })),
    });
  } catch (cause) {
    if (cause instanceof NearbyUnavailableError) return unavailable(cause.code);
    return unavailable("google");
  }
}
