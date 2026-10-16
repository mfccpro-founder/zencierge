import { loadHostListings } from "@/lib/host-listings-server";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireHostUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });
  const listings = await loadHostListings(admin, auth.user.id);
  if (listings.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const { properties, reservations } = listings;
  return Response.json({
    properties: properties.map((property) => ({
      id: property.id,
      name: property.name,
      city: property.city,
    })),
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      propertyId: reservation.propertyId,
      guest: reservation.guest,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      status: reservation.status,
    })),
  });
}
