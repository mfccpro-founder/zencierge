import { NextRequest, NextResponse } from "next/server";
import { localTimeLabel, voiceIdFromAvatarName } from "@/lib/property-agent";
import { loadInboundProperty } from "@/lib/supabase-listings";

export const runtime = "nodejs";

async function inboundFromRequest(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as Record<string, unknown>;
    return {
      propertyId: String(body.propertyId ?? body.property_id ?? ""),
      to: String(body.to ?? body.To ?? ""),
      calledNumber: String(body.called ?? body.Called ?? ""),
    };
  }
  const form = await req.formData();
  return {
    propertyId: String(form.get("propertyId") ?? form.get("property_id") ?? ""),
    to: String(form.get("To") ?? form.get("to") ?? ""),
    calledNumber: String(form.get("Called") ?? form.get("called") ?? ""),
  };
}

export async function POST(req: NextRequest) {
  try {
    const input = await inboundFromRequest(req);
    const property = await loadInboundProperty(input);
    if (!property) {
      return NextResponse.json({ error: "No property matched this number or id" }, { status: 404 });
    }
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
