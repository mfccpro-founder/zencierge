import { fetchListings } from "@/lib/supabase-listings";

export const dynamic = "force-dynamic";

export async function GET() {
  const { properties, reservations } = await fetchListings();
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
