import "server-only";

import type { Reservation } from "@/lib/dashboard-data";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { upsertOwnedReservation } from "@/lib/host-listings-server";
import { requireHostUser } from "@/lib/supabase-route";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function parseReservation(body: unknown): Reservation | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Partial<Reservation>;
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  if (typeof row.propertyId !== "string" || !row.propertyId.trim()) return null;
  if (typeof row.guest !== "string" || typeof row.phone !== "string") return null;
  if (row.platform !== "Airbnb" && row.platform !== "Vrbo" && row.platform !== "Direct") return null;
  if (typeof row.checkIn !== "string" || typeof row.checkOut !== "string") return null;
  if (typeof row.checkInTime !== "string" || typeof row.checkOutTime !== "string") return null;
  if (typeof row.accessCode !== "string" || typeof row.aiNotes !== "string") return null;
  if (!Number.isInteger(row.nights) || (row.nights ?? 0) < 1) return null;
  if (!["staying", "arriving", "departed", "upcoming"].includes(row.status ?? "")) return null;
  return row as Reservation;
}

export async function handleReservationPost(
  request: Request,
  injected?: { hostId: string; admin: SupabaseClient },
) {
  const auth = injected ? null : await requireHostUser();
  if (auth?.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const reservation = parseReservation(body);
  if (!reservation) return Response.json({ error: "Invalid reservation" }, { status: 400 });

  const admin = injected?.admin ?? tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });
  const saved = await upsertOwnedReservation({ admin, hostId: injected?.hostId ?? auth!.user.id, reservation });
  if (saved.kind === "forbidden") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (saved.kind === "conflict") {
    return Response.json({ error: "Reservation id belongs to another property" }, { status: 409 });
  }
  if (saved.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  return Response.json({ ok: true, id: reservation.id });
}

export async function POST(request: Request) {
  return handleReservationPost(request);
}
