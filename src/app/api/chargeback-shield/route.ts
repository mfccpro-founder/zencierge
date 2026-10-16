import { NextResponse } from "next/server";
import { compileChargebackDossiers, formatChargebackDossierText } from "@/lib/chargeback-shield";
import { requireHostUser } from "@/lib/supabase-route";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadHostListings } from "@/lib/host-listings-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireHostUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const reservationId = searchParams.get("reservation");

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  const live = await loadHostListings(admin, auth.user.id);
  if (live.kind === "unavailable") {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const dossiers = compileChargebackDossiers(live.properties, live.reservations);
  if (reservationId) {
    const hit = dossiers.find((row) => row.reservationId === reservationId);
    if (!hit) return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
    return NextResponse.json({ dossier: hit, text: formatChargebackDossierText(hit) });
  }

  return NextResponse.json({ dossiers, count: dossiers.length });
}
