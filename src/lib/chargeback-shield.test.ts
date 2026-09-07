import { readFileSync } from "node:fs";
import { join } from "node:path";
import { properties, reservations, type Property, type Reservation } from "./dashboard-data";
import { compileChargebackDossiers, formatChargebackDossierText } from "./chargeback-shield";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const VALID_SEED_PINS = ["4920#", "7741#", "1206#", "3301#"] as const;

function cloneReservation(overrides: Record<string, unknown> = {}): Reservation {
  return { ...reservations[0]!, ...overrides } as Reservation;
}

function lockPinDetail(reservation: Reservation) {
  const [dossier] = compileChargebackDossiers(properties, [reservation]);
  assert(Boolean(dossier), "dossier compiled");
  const line = dossier!.lockLogs.find((row) => row.title === "Guest PIN issued");
  assert(Boolean(line), "guest PIN line present");
  return { dossier: dossier!, detail: line!.detail, text: formatChargebackDossierText(dossier!) };
}

function assertNoRawPins(haystack: string) {
  for (const pin of VALID_SEED_PINS) {
    assert(!haystack.includes(pin), "raw seed PIN is not exposed");
  }
}

function assertCoverage(reservation: Reservation) {
  const [dossier] = compileChargebackDossiers(properties, [reservation]);
  assert(Boolean(dossier), "coverage dossier compiled");
  assert(
    dossier!.coverage === "complete" || dossier!.coverage === "partial" || dossier!.coverage === "gap",
    "coverage is an allowlisted value",
  );
  assert(
    Number.isInteger(dossier!.coveragePct) && dossier!.coveragePct >= 0 && dossier!.coveragePct <= 100,
    "coveragePct is 0-100",
  );
}

export function runChargebackShieldTests() {
  const libSrc = readFileSync(join(process.cwd(), "src/lib/chargeback-shield.ts"), "utf8");
  const testSrc = readFileSync(join(process.cwd(), "src/lib/chargeback-shield.test.ts"), "utf8");
  const combined = `${libSrc}\n${testSrc}`;

  assert(!/console\.(log|info|debug|warn|error)/.test(libSrc), "no logging of codes or other values");
  assert(!/\bdoorCode\b|\bdoor_code\b/.test(libSrc), "no property door codes");
  assert(
    !/from\s+["'][^"']*(InteractiveConciergeTour|host-guide-tour|host-nav|guest-stay|housekeeping-proof|elena-voice|elena-talk)/.test(
      combined,
    ),
    "no tour, Elena, guest, housekeeping, or Guest Access imports",
  );

  const seed = compileChargebackDossiers(properties, reservations);
  assert(seed.length === reservations.length, "one dossier per seed reservation");
  const seedIds = seed.map((row) => row.reservationId).join(",");
  const expectedIds = [...reservations]
    .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
    .map((row) => row.id)
    .join(",");
  assert(seedIds === expectedIds, "seed ordering is check-in descending");

  const elena = seed.find((row) => row.reservationId === "res-elena");
  assert(Boolean(elena), "seed Elena reservation present");
  assert(elena!.lockLogs[0]!.detail.includes("4•••#"), "valid seed PIN uses existing mask");
  assert(!elena!.lockLogs[0]!.detail.includes("4920#"), "raw seed PIN is not in lock log");
  assert(elena!.communications.some((row) => row.title === "Voice assistant record"), "valid aiNotes still attach");
  assertCoverage(reservations[0]!);
  assertNoRawPins(formatChargebackDossierText(elena!));

  const omitted = { ...reservations[0]! } as Reservation;
  delete (omitted as { accessCode?: string }).accessCode;
  const omittedResult = lockPinDetail(omitted);
  assert(omittedResult.detail.includes("****"), "omitted accessCode masks as ****");
  assert(!omittedResult.detail.includes("•••"), "omitted accessCode does not partial-mask");
  assertNoRawPins(omittedResult.text);

  const nullCode = cloneReservation({ accessCode: null });
  const nullResult = lockPinDetail(nullCode);
  assert(nullResult.detail.includes("****"), "null accessCode masks as ****");
  assertNoRawPins(nullResult.text);

  const blankResult = lockPinDetail(cloneReservation({ accessCode: "  " }));
  assert(blankResult.detail.includes("****"), "blank accessCode masks as ****");

  const leakSentinel = "LEAK-PIN-918273";
  const wrongObject = {
    toString() {
      return leakSentinel;
    },
    valueOf() {
      return leakSentinel;
    },
  };
  const wrongResult = lockPinDetail(cloneReservation({ accessCode: wrongObject }));
  assert(wrongResult.detail.includes("****"), "wrong-type accessCode masks as ****");
  assert(!wrongResult.detail.includes(leakSentinel), "wrong-type accessCode is not coerced into the dossier");
  assert(!wrongResult.text.includes(leakSentinel), "wrong-type accessCode is not in formatted text");
  assertNoRawPins(wrongResult.text);

  const numberResult = lockPinDetail(cloneReservation({ accessCode: 4920 }));
  assert(numberResult.detail.includes("****"), "numeric accessCode masks as ****");
  assert(!numberResult.detail.includes("4920"), "numeric accessCode is not string-coerced");

  const validResult = lockPinDetail(cloneReservation({ accessCode: "4920#" }));
  assert(validResult.detail.includes("4•••#"), "valid accessCode keeps existing mask");
  assert(!validResult.detail.includes("4920#"), "valid accessCode raw value is not exposed");
  assertNoRawPins(validResult.text);

  const omittedNotes = { ...reservations[0]! } as Reservation;
  delete (omittedNotes as { aiNotes?: string }).aiNotes;
  const omittedNotesDossier = compileChargebackDossiers(properties, [omittedNotes])[0]!;
  assert(
    !omittedNotesDossier.communications.some((row) => row.title === "Voice assistant record"),
    "omitted aiNotes does not attach a notes block",
  );

  const nullNotes = compileChargebackDossiers(properties, [cloneReservation({ aiNotes: null })])[0]!;
  assert(
    !nullNotes.communications.some((row) => row.title === "Voice assistant record"),
    "null aiNotes is treated as empty",
  );

  const wrongNotes = compileChargebackDossiers(properties, [cloneReservation({ aiNotes: { text: "should-not-appear" } })])[0]!;
  assert(
    !wrongNotes.communications.some((row) => row.detail.includes("should-not-appear")),
    "wrong-type aiNotes is not coerced",
  );

  const combinedNull = compileChargebackDossiers(properties, [
    cloneReservation({ accessCode: null, aiNotes: null }),
  ]);
  assert(combinedNull.length === 1, "combined null accessCode + aiNotes compiles");
  assert(combinedNull[0]!.lockLogs[0]!.detail.includes("****"), "combined null still masks PIN");
  assertCoverage(cloneReservation({ accessCode: null, aiNotes: null }));
  assertNoRawPins(formatChargebackDossierText(combinedNull[0]!));

  const liveShaped = cloneReservation({
    id: null,
    guest: null,
    phone: null,
    checkIn: null,
    checkOut: null,
    checkInTime: null,
    checkOutTime: null,
    propertyId: "missing-property",
    accessCode: null,
    aiNotes: null,
  });
  const liveDossiers = compileChargebackDossiers(properties, [liveShaped]);
  assert(liveDossiers.length === 1, "live-shaped null identity/date fields compile");
  assert(liveDossiers[0]!.guest === "", "null guest becomes empty string");
  assert(liveDossiers[0]!.propertyName === "missing-property", "unmatched property uses propertyId fallback");
  assertCoverage(liveShaped);
  assertNoRawPins(formatChargebackDossierText(liveDossiers[0]!));

  const dateCheckIn = cloneReservation({ checkIn: new Date("2026-08-22T15:00:00Z"), accessCode: null });
  assert(compileChargebackDossiers(properties, [dateCheckIn]).length === 1, "non-string checkIn compiles");

  const lockProperty = { ...properties[0]!, smartlock: null } as unknown as Property;
  const lockReservation = cloneReservation({ propertyId: lockProperty.id, accessCode: null });
  const lockDossier = compileChargebackDossiers([lockProperty], [lockReservation])[0]!;
  assert(Boolean(lockDossier.lockLogs[0]), "non-string smartlock still produces a lock line");
  assertNoRawPins(formatChargebackDossierText(lockDossier));
  assertCoverage(lockReservation);
}

const isDirectRun = process.argv[1]?.includes("chargeback-shield.test");
if (isDirectRun) {
  try {
    runChargebackShieldTests();
    console.log("chargeback-shield tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "chargeback-shield tests failed");
    process.exitCode = 1;
  }
}
