import { NextRequest } from "next/server";
import { requireHostUser } from "@/lib/supabase-route";
import { fetchListings } from "@/lib/supabase-listings";
import {
  deleteLocalGuide,
  insertLocalGuide,
  listLocalGuideForProperty,
  sanitizeLocalGuideWrite,
  updateLocalGuide,
} from "@/lib/local-guide";
import { hasUnknownGuideKeys, sanitizeGuideText, authorizeLocalGuideWrite } from "@/lib/local-guide-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateHits = new Map<string, number[]>();

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

async function ownedPropertyIds() {
  const { properties } = await fetchListings();
  return properties.map((item) => item.id);
}

export async function GET(request: NextRequest) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  const propertyId = sanitizeGuideText(request.nextUrl.searchParams.get("propertyId") ?? "", 80);
  if (!propertyId) return Response.json({ error: "invalid" }, { status: 400 });
  const owned = await ownedPropertyIds();
  const access = authorizeLocalGuideWrite(auth.user?.id, owned, propertyId);
  if (access === "unauthorized") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (access === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
  const result = await listLocalGuideForProperty(propertyId, auth.supabase);
  return Response.json({ rows: result.rows, setupRequired: result.setupRequired });
}

export async function POST(request: NextRequest) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  if (rateLimited(`w:${auth.user?.id ?? "anon"}`)) {
    return Response.json({ error: "unavailable" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  if (hasUnknownGuideKeys(body)) return Response.json({ error: "invalid" }, { status: 400 });
  const parsed = sanitizeLocalGuideWrite(body);
  if (parsed.error || !parsed.value) return Response.json({ error: parsed.error ?? "invalid" }, { status: 400 });
  const owned = await ownedPropertyIds();
  const access = authorizeLocalGuideWrite(auth.user?.id, owned, parsed.value.propertyId);
  if (access === "unauthorized") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (access === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
  const saved = await insertLocalGuide(parsed.value, auth.supabase);
  if (saved.setupRequired) return Response.json({ error: "setup_required", setupRequired: true }, { status: 503 });
  if (!saved.row) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({ row: saved.row });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  if (rateLimited(`w:${auth.user?.id ?? "anon"}`)) {
    return Response.json({ error: "unavailable" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  if (hasUnknownGuideKeys(body)) return Response.json({ error: "invalid" }, { status: 400 });
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const parsed = sanitizeLocalGuideWrite(body);
  if (!id || parsed.error || !parsed.value) return Response.json({ error: parsed.error ?? "invalid" }, { status: 400 });
  const owned = await ownedPropertyIds();
  const access = authorizeLocalGuideWrite(auth.user?.id, owned, parsed.value.propertyId);
  if (access === "unauthorized") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (access === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
  const saved = await updateLocalGuide(id, parsed.value.propertyId, parsed.value, auth.supabase);
  if (saved.setupRequired) return Response.json({ error: "setup_required", setupRequired: true }, { status: 503 });
  if (saved.forbidden) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!saved.row) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({ row: saved.row });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  if (rateLimited(`w:${auth.user?.id ?? "anon"}`)) {
    return Response.json({ error: "unavailable" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  if (Object.keys(body).some((key) => key !== "id" && key !== "propertyId")) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const propertyId = sanitizeGuideText(body.propertyId, 80);
  if (!id || !propertyId) return Response.json({ error: "invalid" }, { status: 400 });
  const owned = await ownedPropertyIds();
  const access = authorizeLocalGuideWrite(auth.user?.id, owned, propertyId);
  if (access === "unauthorized") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (access === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
  const saved = await deleteLocalGuide(id, propertyId, auth.supabase);
  if (saved.setupRequired) return Response.json({ error: "setup_required", setupRequired: true }, { status: 503 });
  if (saved.forbidden) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!saved.ok) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({ ok: true });
}
