import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type GuestRiskLevel = "clear" | "watch" | "flagged" | "unknown";
export type GuestRiskTag = "chargeback" | "false_dispute" | "watch" | "clear";

export type GuestDnaRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  propertyId: string;
  riskStatus: GuestRiskLevel;
  riskTags: GuestRiskTag[];
  riskNotes: string | null;
  checkInAt: string;
  marketingOptIn: boolean;
};

export type GuestDnaSnapshot = {
  serviceRoleReady: boolean;
  error: string | null;
  guests: GuestDnaRow[];
  metrics: { total: number; leads: number; flagged: number; watch: number; clear: number };
};

export function normalizePhone(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? `+${digits.slice(1).replace(/\D/g, "")}` : digits;
}

export function extractRiskTags(notes: string | null, level: GuestRiskLevel): GuestRiskTag[] {
  const text = (notes ?? "").toLowerCase();
  const tags = new Set<GuestRiskTag>();
  if (text.includes("chargeback") || text.includes("contracargo")) tags.add("chargeback");
  if (text.includes("false dispute") || text.includes("disputa falsa") || text.includes("aircover abuse")) {
    tags.add("false_dispute");
  }
  if (level === "watch") tags.add("watch");
  if (level === "clear") tags.add("clear");
  if (level === "flagged" && tags.size === 0) tags.add("chargeback");
  return [...tags];
}

const DEMO_GUESTS: GuestDnaRow[] = [
  {
    id: "demo-g1",
    fullName: "Sofia Alvarez",
    email: "sofia.alvarez@example.com",
    phone: "+1 305 555 0142",
    propertyId: "prop-1",
    riskStatus: "flagged",
    riskTags: ["chargeback"],
    riskNotes: "Prior chargeback on a Miami Beach stay (2025).",
    checkInAt: "2026-08-03T15:00:00.000Z",
    marketingOptIn: true,
  },
  {
    id: "demo-g2",
    fullName: "Owen Blake",
    email: "owen.blake@example.com",
    phone: "+1 954 555 0199",
    propertyId: "prop-2",
    riskStatus: "flagged",
    riskTags: ["false_dispute"],
    riskNotes: "False dispute / AirCover abuse pattern on a prior Vrbo booking.",
    checkInAt: "2026-08-10T16:00:00.000Z",
    marketingOptIn: false,
  },
  {
    id: "demo-g3",
    fullName: "Camille Dubois",
    email: "camille.d@example.com",
    phone: "+1 786 555 0108",
    propertyId: "prop-3",
    riskStatus: "watch",
    riskTags: ["watch"],
    riskNotes: "Noise complaint last stay; no chargeback.",
    checkInAt: "2026-08-14T15:00:00.000Z",
    marketingOptIn: true,
  },
];

export async function getGuestDnaSnapshot(): Promise<GuestDnaSnapshot> {
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return {
      serviceRoleReady: false,
      error: error instanceof Error ? error.message : "SUPABASE_SERVICE_ROLE_KEY is not configured.",
      guests: DEMO_GUESTS,
      metrics: {
        total: DEMO_GUESTS.length,
        leads: DEMO_GUESTS.filter((guest) => guest.marketingOptIn).length,
        flagged: DEMO_GUESTS.filter((guest) => guest.riskStatus === "flagged").length,
        watch: DEMO_GUESTS.filter((guest) => guest.riskStatus === "watch").length,
        clear: DEMO_GUESTS.filter((guest) => guest.riskStatus === "clear").length,
      },
    };
  }

  const [guestsResult, riskResult] = await Promise.all([
    admin.from("captured_guests").select("*").order("check_in_at", { ascending: false }).limit(500),
    admin.from("guest_risk_profiles").select("phone, email, risk_level, notes"),
  ]);

  const error = guestsResult.error?.message ?? riskResult.error?.message ?? null;
  const guestRows = guestsResult.data ?? [];
  const riskRows = riskResult.data ?? [];

  const riskByEmail = new Map(
    riskRows.filter((row) => row.email).map((row) => [String(row.email).toLowerCase(), row]),
  );
  const riskByPhone = new Map(
    riskRows.filter((row) => row.phone).map((row) => [normalizePhone(String(row.phone)), row]),
  );

  const guests: GuestDnaRow[] = guestRows.map((row) => {
    const emailKey = String(row.email ?? "").toLowerCase();
    const phoneKey = normalizePhone(String(row.phone ?? ""));
    const profile = riskByEmail.get(emailKey) ?? riskByPhone.get(phoneKey);
    const storedStatus = String(row.risk_status ?? "unknown");
    const riskLevel = (profile?.risk_level ?? storedStatus) as GuestRiskLevel;
    return {
      id: String(row.id),
      fullName: String(row.full_name ?? "—"),
      email: String(row.email ?? "—"),
      phone: String(row.phone ?? "—"),
      propertyId: String(row.property_id ?? "—"),
      riskStatus: ["clear", "watch", "flagged"].includes(riskLevel) ? riskLevel : "unknown",
      riskTags: extractRiskTags(profile?.notes ? String(profile.notes) : null, ["clear", "watch", "flagged"].includes(riskLevel) ? riskLevel : "unknown"),
      riskNotes: profile?.notes ? String(profile.notes) : null,
      checkInAt: String(row.check_in_at ?? new Date().toISOString()),
      marketingOptIn: Boolean(row.marketing_opt_in),
    };
  });

  const roster = guests.length > 0 ? guests : DEMO_GUESTS;
  return {
    serviceRoleReady: true,
    error,
    guests: roster,
    metrics: {
      total: roster.length,
      leads: roster.filter((guest) => guest.marketingOptIn).length,
      flagged: roster.filter((guest) => guest.riskStatus === "flagged").length,
      watch: roster.filter((guest) => guest.riskStatus === "watch").length,
      clear: roster.filter((guest) => guest.riskStatus === "clear").length,
    },
  };
}

export function guestDnaCsv(guests: GuestDnaRow[]) {
  const header = "full_name,email,phone,property_id,risk_status,risk_tags,check_in_at,marketing_opt_in";
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = guests.map((guest) =>
    [
      escape(guest.fullName),
      escape(guest.email),
      escape(guest.phone),
      escape(guest.propertyId),
      guest.riskStatus,
      escape((guest.riskTags ?? []).join("|")),
      guest.checkInAt,
      guest.marketingOptIn ? "1" : "0",
    ].join(","),
  );
  return [header, ...lines].join("\r\n");
}
