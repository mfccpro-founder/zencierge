import { type Property, type Reservation } from "@/lib/dashboard-data";

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
  coveragePct: number | null;
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

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function compileChargebackDossiers(
  properties: Property[],
  reservations: Reservation[],
): ChargebackDossier[] {
  const propertyById = new Map(properties.map((property) => [property.id, property]));

  return [...reservations]
    .filter((row): row is Reservation => Boolean(row) && typeof row === "object")
    .sort((a, b) => asText(b.checkIn).localeCompare(asText(a.checkIn)))
    .map((reservation) => {
      const reservationId = asText(reservation.id);
      const propertyId = asText(reservation.propertyId);
      const guest = asText(reservation.guest);
      const phone = asText(reservation.phone);
      const platform = asText(reservation.platform);
      const checkIn = asText(reservation.checkIn);
      const checkOut = asText(reservation.checkOut);
      const checkInTime = asText(reservation.checkInTime);
      const checkOutTime = asText(reservation.checkOutTime);
      const property = propertyById.get(propertyId);
      const propertyName = asText(property?.name, propertyId);
      const notRecorded = (category: string): ShieldLogLine[] => [{
        at: "No registrado",
        title: "No registrado",
        detail: `No hay evidencia persistida y verificable de ${category} para esta reserva.`,
      }];

      return {
        id: `cb-${reservationId}`,
        reservationId,
        propertyId,
        propertyName,
        guest,
        phone,
        platform,
        checkIn: `${checkIn} · ${checkInTime}`,
        checkOut: `${checkOut} · ${checkOutTime}`,
        nights: reservation.nights,
        stayStatus: reservation.status,
        coverage: "gap",
        coveragePct: null,
        exhibitId: exhibitId(reservationId),
        signatures: notRecorded("aceptación o firma de reglas"),
        lockLogs: notRecorded("eventos de cerradura"),
        communications: notRecorded("comunicaciones"),
        housekeeping: notRecorded("inspecciones o fotografías vinculadas"),
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
    "Evidence coverage: No registrado",
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
    "E. CLAIM PREPARATION STATUS",
    "- Draft only. No platform claim has been filed by Zencierge.",
    "- Eligibility, legal compliance, responsibility, and reimbursement outcome are not determined here.",
    "",
    "Notice: Include only source evidence that has been independently recorded and verified.",
  ].join("\n");
}
