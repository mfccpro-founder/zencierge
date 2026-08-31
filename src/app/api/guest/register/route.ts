import { createClient } from "@supabase/supabase-js";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  isSupabaseCredentialError,
  isValidSupabaseAnonKey,
  isValidSupabaseUrl,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "@/lib/supabase-config";
import { normalizePhone } from "@/lib/admin-guest-dna";

export const dynamic = "force-dynamic";

type RiskPayload = { level: "clear" | "watch" | "flagged" | "unknown"; notes: string | null };

function isIgnorableWriteError(message: string) {
  const lower = message.toLowerCase();
  return (
    isSupabaseCredentialError(message) ||
    lower.includes("duplicate") ||
    lower.includes("unique") ||
    lower.includes("already exists")
  );
}

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
  const admin = tryCreateSupabaseAdminClient();

  let risk: RiskPayload = { level: "unknown", notes: null };
  if (admin) {
    const orFilter = `phone.eq.${phone},email.eq.${email}`;
    const { data: profiles, error: riskError } = await admin
      .from("guest_risk_profiles")
      .select("risk_level, notes")
      .or(orFilter)
      .limit(1);
    if (riskError) {
      console.warn("[guest/register] risk lookup skipped:", riskError.message);
    } else {
      const profile = profiles?.[0];
      if (profile) {
        risk = {
          level: profile.risk_level as RiskPayload["level"],
          notes: profile.notes ? String(profile.notes) : null,
        };
      }
    }
  }

  const row = {
    property_id: propertyId,
    full_name: fullName,
    phone,
    email,
    risk_status: risk.level,
  };

  let wrote = false;
  if (admin) {
    const { error: insertError } = await admin.from("captured_guests").upsert(row, {
      onConflict: "property_id,email",
    });
    if (!insertError) {
      wrote = true;
    } else if (isIgnorableWriteError(insertError.message)) {
      console.warn("[guest/register] host database write skipped:", insertError.message);
    } else {
      console.warn("[guest/register] host database write failed:", insertError.message);
    }
  }

  if (!wrote && isValidSupabaseUrl() && isValidSupabaseAnonKey()) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error: insertError } = await anon.from("captured_guests").insert(row);
    if (!insertError) {
      wrote = true;
    } else if (isIgnorableWriteError(insertError.message)) {
      console.warn("[guest/register] anon write skipped:", insertError.message);
    } else {
      console.warn("[guest/register] anon write failed:", insertError.message);
    }
  }

  if (!wrote) {
    console.info("[guest/register] Check-in completed without a host-database write (missing or rejected keys).");
  }

  return Response.json({ ok: true, risk });
}
