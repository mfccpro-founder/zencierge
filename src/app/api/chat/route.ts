import { NextRequest, NextResponse } from "next/server";
import { answerGuestQuestion } from "@/lib/receptionist-replies";
import { detectUtteranceLang } from "@/lib/human-voice";
import { requireHostUser } from "@/lib/supabase-route";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadHostListings } from "@/lib/host-listings-server";
import { authorizeGuestProperty } from "@/lib/guest-property-access";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      propertyId?: string;
      to?: string;
      To?: string;
      called?: string;
      Called?: string;
      history?: Array<{ role: "user" | "assistant"; content?: string }>;
      token?: string;
    };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const admin = tryCreateSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    const propertyId = body.propertyId?.trim() ?? "";
    let listings;
    if (Object.hasOwn(body, "token")) {
      const guest = await authorizeGuestProperty({ admin, token: body.token, requestedPropertyId: propertyId });
      if (guest.kind === "rejected") return NextResponse.json({ error: guest.error }, { status: guest.status });
      listings = [guest.property];
    } else {
      const auth = await requireHostUser();
      if (auth.error) return auth.error;
      const owned = await loadHostListings(admin, auth.user.id);
      if (owned.kind === "unavailable") return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
      listings = owned.properties;
    }
    const routed = propertyId ? listings.find((property) => property.id === propertyId) ?? null : listings[0] ?? null;
    if (!routed) {
      return NextResponse.json({ error: "No property matched this number or id" }, { status: 404 });
    }
    const fallback = routed;
    const lang = detectUtteranceLang(message);

    const history: Array<{ role: "user" | "assistant"; content: string }> = Array.isArray(
      body.history,
    )
      ? body.history
          .filter((turn) => turn && typeof turn.content === "string")
          .map((turn) => ({
            role: turn.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: String(turn.content).slice(0, 600).trim(),
          }))
          .filter((turn) => turn.content.length > 0)
          .slice(-8)
      : [];

    const reply = answerGuestQuestion({
      question: message,
      properties: listings,
      fallback,
      language: lang,
      history,
    });

    return NextResponse.json({
      reply,
      lang,
      propertyId: fallback.id,
      assignedAvatarName: fallback.assignedAvatarName,
      timezone: fallback.timezone,
    });
  } catch (cause) {
    console.error("[chat] failed to generate reply", cause);
    return NextResponse.json({ error: "Could not generate reply" }, { status: 500 });
  }
}
