import { properties, reservations } from "./dashboard-data";
import { compileChargebackDossiers, formatChargebackDossierText } from "./chargeback-shield";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runChargebackShieldTests() {
  const dossiers = compileChargebackDossiers(properties, reservations);
  assert(dossiers.length === reservations.length, "one inventory per reservation");
  for (const dossier of dossiers) {
    assert(dossier.coveragePct === null, "no inferred coverage percentage");
    for (const block of [dossier.signatures, dossier.lockLogs, dossier.communications, dossier.housekeeping]) {
      assert(block.length === 1, "one explicit missing-evidence marker");
      assert(block[0]?.title === "No registrado", "missing evidence is explicit");
    }
    const text = formatChargebackDossierText(dossier);
    assert(text.includes("Evidence coverage: No registrado"), "export says evidence is not recorded");
    assert(!/signature captured|PIN issued|door unlocked|photos stored|coverage:\s*\d/i.test(text), "no inferred facts");
    assert(!text.includes(String((reservations.find((row) => row.id === dossier.reservationId) as { accessCode?: string })?.accessCode)), "raw PIN absent");
  }
}

if (process.argv[1]?.includes("chargeback-shield.test")) {
  try {
    runChargebackShieldTests();
    console.log("chargeback-shield tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "chargeback-shield tests failed");
    process.exitCode = 1;
  }
}
