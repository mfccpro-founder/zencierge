import { NextResponse } from "next/server";
import { properties as seedProperties, reservations as seedReservations } from "@/lib/dashboard-data";
import { compileChargebackDossiers, formatChargebackDossierText } from "@/lib/chargeback-shield";
import { fetchListings } from "@/lib/supabase-listings";
import { requireHostUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireHostUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const reservationId = searchParams.get("reservation");

  let properties = seedProperties;
  let reservations = seedReservations;
  try {
    const live = await fetchListings();
    if (live.properties.length) properties = live.properties;
    if (live.reservations.length) reservations = live.reservations;
  } catch {
    /* seed fallback */
  }

  const dossiers = compileChargebackDossiers(properties, reservations);
  if (reservationId) {
    const hit = dossiers.find((row) => row.reservationId === reservationId);
    if (!hit) return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
    return NextResponse.json({ dossier: hit, text: formatChargebackDossierText(hit) });
  }

  return NextResponse.json({ dossiers, count: dossiers.length });
}
