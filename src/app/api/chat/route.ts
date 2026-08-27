import { NextRequest, NextResponse } from "next/server";
import { properties, type Property } from "@/lib/dashboard-data";
import { answerGuestQuestion } from "@/lib/receptionist-replies";

export const runtime = "nodejs";

const FALLBACK_PROPERTY: Property = properties[0];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { message?: string; propertyId?: string };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const property = properties.find((p) => p.id === body.propertyId) ?? FALLBACK_PROPERTY;

    const reply = answerGuestQuestion({
      question: message,
      properties,
      fallback: property,
      language: "es",
    });

    return NextResponse.json({ reply });
  } catch (cause) {
    console.error("[chat] failed to generate reply", cause);
    return NextResponse.json({ error: "Could not generate reply" }, { status: 500 });
  }
}