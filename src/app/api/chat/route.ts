import { NextRequest, NextResponse } from "next/server";
import { properties as seedProperties, type Property } from "@/lib/dashboard-data";
import { answerGuestQuestion } from "@/lib/receptionist-replies";
import { detectUtteranceLang } from "@/lib/human-voice";
import { fetchListings, loadInboundProperty } from "@/lib/supabase-listings";

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
    };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const to = body.to ?? body.To;
    const called = body.called ?? body.Called;
    const hasRouteHint = Boolean(body.propertyId?.trim() || to?.trim() || called?.trim());
    const { properties } = await fetchListings();
    const listings = properties.length ? properties : seedProperties;
    const routed = await loadInboundProperty({
      propertyId: body.propertyId,
      to,
      calledNumber: called,
    });
    if (hasRouteHint && !routed) {
      return NextResponse.json({ error: "No property matched this number or id" }, { status: 404 });
    }
    const fallback: Property = routed ?? listings[0]!;
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
