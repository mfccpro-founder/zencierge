import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";
import { normalizePhone } from "@/lib/admin-guest-dna";

export const dynamic = "force-dynamic";

type RiskPayload = { level: "clear" | "watch" | "flagged" | "unknown"; notes: string | null };

export async function POST(request: Request) {
  let body: { propertyId?: string; fullName?: string; phone?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const propertyId = (body.propertyId ?? "").trim();
  const fullName = (body.fullName ?? "").trim();
  const phoneRaw = (body.phone ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();

  if (!propertyId || fullName.length < 2 || email.length < 5 || !email.includes("@")) {
    return Response.json({ error: "Full name, a valid email, and property are required." }, { status: 400 });
  }
  if (normalizePhone(phoneRaw).replace(/\D/g, "").length < 7) {
    return Response.json({ error: "A valid WhatsApp phone number is required." }, { status: 400 });
  }

  const phone = normalizePhone(phoneRaw);
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    admin = null;
  }

  // Risk cross-check happens first so the stored status reflects the profile.
  let risk: RiskPayload = { level: "unknown", notes: null };
  if (admin) {
    const orFilter = `phone.eq.${phone},email.eq.${email}`;
    const { data: profiles } = await admin.from("guest_risk_profiles").select("risk_level, notes").or(orFilter).limit(1);
    const profile = profiles?.[0];
    if (profile) {
      risk = { level: profile.risk_level as RiskPayload["level"], notes: profile.notes ? String(profile.notes) : null };
    }
  }

  if (admin) {
    const { error: insertError } = await admin.from("captured_guests").upsert(
      { property_id: propertyId, full_name: fullName, phone, email, risk_status: risk.level },
      { onConflict: "property_id,email" },
    );
    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }
  } else {
    // No service key configured: fall back to the anon RLS insert policy.
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error: insertError } = await anon.from("captured_guests").insert({
      property_id: propertyId,
      full_name: fullName,
      phone,
      email,
      risk_status: risk.level,
    });
    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }
  }

  return Response.json({ ok: true, risk });
}
