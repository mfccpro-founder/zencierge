import { requireHostUser } from "@/lib/supabase-route";
import { getGuestDnaSnapshot, guestDnaCsv } from "@/lib/admin-guest-dna";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireHostUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const snapshot = await getGuestDnaSnapshot();
  const format = new URL(request.url).searchParams.get("format");

  if (format === "csv") {
    const leads = snapshot.guests.filter((guest) => guest.marketingOptIn);
    return new Response(guestDnaCsv(leads), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="zencierge-direct-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return Response.json(snapshot);
}
