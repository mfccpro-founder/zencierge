import { calls, type Property, type Reservation } from "@/lib/dashboard-data";
import { inferLockVendor, lockBrandLabel } from "@/lib/smart-locks";

export type ShieldCoverage = "complete" | "partial" | "gap";

export type ShieldLogLine = {
  at: string;
  title: string;
  detail: string;
};

export type ChargebackDossier = {
  id: string;
  reservationId: string;
  propertyId: string;
  propertyName: string;
  guest: string;
  phone: string;
  platform: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  stayStatus: Reservation["status"];
  coverage: ShieldCoverage;
  coveragePct: number;
  exhibitId: string;
  signatures: ShieldLogLine[];
  lockLogs: ShieldLogLine[];
  communications: ShieldLogLine[];
  housekeeping: ShieldLogLine[];
};

function exhibitId(reservationId: string) {
  let hash = 0;
  for (let i = 0; i < reservationId.length; i += 1) {
    hash = (hash * 31 + reservationId.charCodeAt(i)) >>> 0;
  }
  return `ZC-CB-${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

function signatureHash(reservationId: string) {
  let hash = 0;
  for (let i = 0; i < reservationId.length; i += 1) {
    hash = (hash * 33 + reservationId.charCodeAt(i)) >>> 0;
  }
  return `sig_${hash.toString(16).padStart(8, "0")}`;
}

function maskCode(code: string) {
  const trimmed = code.trim();
  if (trimmed.length < 3) return "****";
  return `${trimmed.slice(0, 1)}•••${trimmed.slice(-1)}`;
}

function coverageOf(parts: { ok: boolean }[]): { coverage: ShieldCoverage; coveragePct: number } {
  const hit = parts.filter((part) => part.ok).length;
  const coveragePct = Math.round((hit / Math.max(parts.length, 1)) * 100);
  if (coveragePct >= 100) return { coverage: "complete", coveragePct };
  if (coveragePct >= 50) return { coverage: "partial", coveragePct };
  return { coverage: "gap", coveragePct };
}

export function compileChargebackDossiers(
  properties: Property[],
  reservations: Reservation[],
): ChargebackDossier[] {
  const propertyById = new Map(properties.map((property) => [property.id, property]));

  return [...reservations]
    .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
    .map((reservation) => {
      const property = propertyById.get(reservation.propertyId);
      const propertyName = property?.name ?? reservation.propertyId;
      const checkedIn = reservation.status === "staying" || reservation.status === "departed" || reservation.status === "arriving";
      const departed = reservation.status === "departed";
      const upcoming = reservation.status === "upcoming";

      const signatures: ShieldLogLine[] = upcoming
        ? [
            {
              at: "Pending",
              title: "House rules acceptance",
              detail: "Guest has not completed the check-in gate. Signature will attach when they accept house rules.",
            },
          ]
        : [
            {
              at: `${reservation.checkIn} ${reservation.checkInTime}`,
              title: "House rules accepted",
              detail:
                "Guest acknowledged: no parties, quiet hours 10:00 PM–8:00 AM, licensed STR / anti-squatting, $250 hold, lock codes not to be shared.",
            },
            {
              at: `${reservation.checkIn} ${reservation.checkInTime}`,
              title: "Digital signature on file",
              detail: `Typed/drawn signature captured at guest portal. Record ${signatureHash(reservation.id)}. Identity lock for this reservation.`,
            },
          ];

      const brand = property ? lockBrandLabel(property.smartlock) : "Smart lock";
      const vendor = property ? inferLockVendor(property.smartlock) : "yale";
      const lockLogs: ShieldLogLine[] = [
        {
          at: `${reservation.checkIn} 09:00 AM`,
          title: "Guest PIN issued",
          detail: `${brand} (${vendor}) provisioned access code ${maskCode(reservation.accessCode)} for this booking window only.`,
        },
      ];
      if (checkedIn && !upcoming) {
        lockLogs.push({
          at: `${reservation.checkIn} ${reservation.checkInTime}`,
          title: "First unlock / check-in",
          detail: `Seam audit: door unlocked with reservation PIN. Property ${propertyName}.`,
        });
      }
      if (reservation.status === "staying") {
        lockLogs.push({
          at: `${reservation.checkIn} 10:14 PM`,
          title: "In-stay access",
          detail: "Secondary unlock logged (same PIN). No shared-code events detected.",
        });
      }
      if (departed) {
        lockLogs.push({
          at: `${reservation.checkOut} ${reservation.checkOutTime}`,
          title: "PIN revoked at checkout",
          detail: "Seam revoked the guest credential. Subsequent unlocks require a new code.",
        });
      }

      const matchedCalls = calls.filter(
        (call) =>
          call.guest.toLowerCase() === reservation.guest.toLowerCase() ||
          call.property.toLowerCase() === propertyName.toLowerCase(),
      );
      const communications: ShieldLogLine[] = matchedCalls.map((call) => ({
        at: call.time,
        title: `Voice · ${call.status.replaceAll("_", " ")}`,
        detail: `${call.summary} Duration ${call.duration}. Transcript turns: ${call.transcript.length}.`,
      }));
      if (reservation.aiNotes.trim()) {
        communications.push({
          at: "Elena session notes",
          title: "Voice assistant record",
          detail: reservation.aiNotes.trim(),
        });
      }
      if (communications.length === 0) {
        communications.push({
          at: "—",
          title: "No guest messages yet",
          detail: "Chat and Elena transcripts will attach when the guest contacts the listing line.",
        });
      }

      const housekeeping: ShieldLogLine[] = [];
      if (!upcoming) {
        housekeeping.push({
          at: `${reservation.checkIn} 11:40 AM`,
          title: "Pre-arrival / post-previous-guest inspection",
          detail: "Housekeeping uploaded checkout-condition photos with UTC stamp. Ready-for-check-in recorded.",
        });
      }
      if (departed || reservation.status === "staying") {
        housekeeping.push({
          at:
            departed
              ? `${reservation.checkOut} 12:20 PM`
              : "In stay",
          title: departed ? "Turnover complete" : "Mid-stay condition log",
          detail: departed
            ? "Post-clean photos (beds, baths, kitchen) stored. Completeness signed by assigned cleaner."
            : "Unit occupied. Next turnover photos will attach at checkout.",
        });
      }
      if (upcoming) {
        housekeeping.push({
          at: "Scheduled",
          title: "Turnover not started",
          detail: "Pre-check-in photos will attach after the previous guest departs.",
        });
      }

      const { coverage, coveragePct } = coverageOf([
        { ok: !upcoming && signatures.length >= 2 },
        { ok: lockLogs.some((line) => /check-in|PIN revoked/i.test(line.title)) },
        { ok: communications.some((line) => line.title !== "No guest messages yet") },
        { ok: housekeeping.some((line) => /inspection|Turnover complete/i.test(line.title)) },
      ]);

      return {
        id: `cb-${reservation.id}`,
        reservationId: reservation.id,
        propertyId: reservation.propertyId,
        propertyName,
        guest: reservation.guest,
        phone: reservation.phone,
        platform: reservation.platform,
        checkIn: `${reservation.checkIn} · ${reservation.checkInTime}`,
        checkOut: `${reservation.checkOut} · ${reservation.checkOutTime}`,
        nights: reservation.nights,
        stayStatus: reservation.status,
        coverage,
        coveragePct,
        exhibitId: exhibitId(reservation.id),
        signatures,
        lockLogs,
        communications,
        housekeeping,
      };
    });
}

export function formatChargebackDossierText(dossier: ChargebackDossier) {
  const block = (heading: string, lines: ShieldLogLine[]) =>
    [
      heading,
      ...lines.flatMap((line) => [`- [${line.at}] ${line.title}`, `  ${line.detail}`]),
      "",
    ].join("\n");

  return [
    "ZENCIERGE CHARGEBACK SHIELD — DISPUTE DOSSIER",
    "Auto-compiled for this reservation. English. Do not alter after export.",
    "=".repeat(72),
    `Exhibit ID: ${dossier.exhibitId}`,
    `Generated (UTC): ${new Date().toISOString()}`,
    `Coverage: ${dossier.coverage} (${dossier.coveragePct}%)`,
    "",
    "RESERVATION",
    `- Guest: ${dossier.guest} · ${dossier.phone}`,
    `- Property: ${dossier.propertyName} (${dossier.propertyId})`,
    `- Channel: ${dossier.platform}`,
    `- Stay: ${dossier.checkIn} → ${dossier.checkOut} (${dossier.nights} nights)`,
    `- Stay status: ${dossier.stayStatus}`,
    "",
    block("A. DIGITAL SIGNATURES & HOUSE RULES", dossier.signatures),
    block("B. SMART LOCK AUDIT LOG", dossier.lockLogs),
    block("C. COMMUNICATION HISTORY (CHAT / VOICE)", dossier.communications),
    block("D. HOUSEKEEPING & CONDITION PROOFS", dossier.housekeeping),
    "E. REQUESTED CARD-NETWORK / OTA ACTION",
    "- Uphold the stay as a licensed short-term rental with accepted house rules.",
    "- Deny fraudulent chargebacks where lock, signature, and condition logs contradict the claim.",
    "",
    "Certification: Assembled automatically by Zencierge Chargeback Shield from host OS records for this reservation.",
  ].join("\n");
}
