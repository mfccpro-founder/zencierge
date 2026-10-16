import { NextRequest, NextResponse } from "next/server";
import { localTimeLabel, voiceIdFromAvatarName } from "@/lib/property-agent";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadInboundPropertyByNumber } from "@/lib/host-listings-server";
import { validateTwilioFormSignature } from "@/lib/twilio-webhook";

export const runtime = "nodejs";

async function inboundFromRequest(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) return null;
  const raw = await req.text();
  const form = new URLSearchParams(raw);
  return {
    form,
    to: form.get("To") ?? form.get("to") ?? "",
    calledNumber: form.get("Called") ?? form.get("called") ?? "",
  };
}

export async function POST(req: NextRequest) {
  try {
    const input = await inboundFromRequest(req);
    if (!input) return NextResponse.json({ error: "Unsupported webhook payload" }, { status: 415 });
    const authorized = validateTwilioFormSignature({
      authToken: process.env.TWILIO_AUTH_TOKEN?.trim() ?? "",
      signature: req.headers.get("x-twilio-signature")?.trim() ?? "",
      url: process.env.TWILIO_INBOUND_WEBHOOK_URL?.trim() || req.url,
      params: input.form,
    });
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const dialed = input.to.trim() || input.calledNumber.trim();
    const admin = tryCreateSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    const resolved = await loadInboundPropertyByNumber(admin, dialed);
    if (resolved.kind === "unavailable") {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    if (resolved.kind === "missing") {
      return NextResponse.json({ error: "No property matched this number or id" }, { status: 404 });
    }
    const property = resolved.property;
    return NextResponse.json({
      propertyId: property.id,
      listing: property.name,
      assignedAvatarName: property.assignedAvatarName,
      assignedPhoneNumber: property.assignedPhoneNumber,
      timezone: property.timezone,
      localTime: localTimeLabel(property.timezone),
      avatarSystemPrompt: property.avatarSystemPrompt,
      handbook: property.handbook,
      voiceId: voiceIdFromAvatarName(property.assignedAvatarName),
    });
  } catch (cause) {
    console.error("[inbound] failed to route property", cause);
    return NextResponse.json({ error: "Could not route inbound" }, { status: 500 });
  }
}
