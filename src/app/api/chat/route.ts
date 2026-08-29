import { NextRequest, NextResponse } from "next/server";
import { properties, type Property } from "@/lib/dashboard-data";
import { answerGuestQuestion } from "@/lib/receptionist-replies";
import { detectUtteranceLang } from "@/lib/human-voice";

export const runtime = "nodejs";

const FALLBACK_PROPERTY: Property = properties[0];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      propertyId?: string;
      history?: Array<{ role: "user" | "assistant"; content?: string }>;
    };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const property = properties.find((p) => p.id === body.propertyId) ?? FALLBACK_PROPERTY;
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
      properties,
      fallback: property,
      language: lang,
      history,
    });

    return NextResponse.json({ reply, lang });
  } catch (cause) {
    console.error("[chat] failed to generate reply", cause);
    return NextResponse.json({ error: "Could not generate reply" }, { status: 500 });
  }
}
