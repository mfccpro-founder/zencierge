import {
  authorizeLocalGuideWrite,
  formatHostGuideSpeech,
  hasUnknownGuideKeys,
  isMissingLocalGuideTable,
  nearbyFromHostOrGoogle,
  sanitizeLocalGuideWrite,
  selectGuestGuideRows,
  type LocalGuideHostRow,
} from "./local-guide-shared";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function hostRow(partial: Partial<LocalGuideHostRow> & Pick<LocalGuideHostRow, "id" | "businessName">): LocalGuideHostRow {
  return {
    category: "restaurant",
    distanceMiles: null,
    hostNote: "",
    websiteOrMapsLink: "",
    source: "host",
    propertyId: "prop-1",
    active: true,
    sortOrder: 0,
    ...partial,
  };
}

export function runLocalGuideSharedTests() {
  assert(authorizeLocalGuideWrite(null, ["prop-1"], "prop-1") === "unauthorized", "unauthenticated writes must be rejected");
  assert(authorizeLocalGuideWrite(undefined, ["prop-1"], "prop-1") === "unauthorized", "missing user must be rejected");
  assert(authorizeLocalGuideWrite("host-1", ["prop-1"], "prop-2") === "forbidden", "cross-property writes must be rejected");
  assert(authorizeLocalGuideWrite("host-1", ["prop-1"], "prop-1") === "ok", "owner write should be allowed");

  assert(hasUnknownGuideKeys({ propertyId: "p", extra: true }), "unknown body keys must be rejected");
  assert(sanitizeLocalGuideWrite({ propertyId: "p", category: "spa", businessName: "X" }).error === "invalid_category", "invalid category must be rejected");
  assert(
    sanitizeLocalGuideWrite({
      propertyId: "p",
      category: "restaurant",
      businessName: "X",
      websiteOrMapsLink: "javascript:alert(1)",
    }).error === "invalid_link",
    "non-http links must be rejected",
  );
  assert(
    sanitizeLocalGuideWrite({
      propertyId: "p",
      category: "restaurant",
      businessName: "X",
      websiteOrMapsLink: "ftp://files.example",
    }).error === "invalid_link",
    "ftp links must be rejected",
  );

  const rows = [
    hostRow({ id: "1", businessName: "La Sandwicherie", distanceMiles: 0.5, sortOrder: 1 }),
    hostRow({ id: "2", businessName: "Puerto Sagua", distanceMiles: 1, sortOrder: 2 }),
    hostRow({ id: "3", businessName: "Too Far", distanceMiles: 9, sortOrder: 0 }),
    hostRow({ id: "4", businessName: "Inactive Cafe", active: false, sortOrder: 0 }),
    hostRow({ id: "5", businessName: "Null Distance Spot", distanceMiles: null, sortOrder: 3 }),
    hostRow({ id: "6", businessName: "Fourth Keep Out", distanceMiles: 0.2, sortOrder: 4 }),
    hostRow({ id: "7", businessName: "Hospital Far", category: "hospital", distanceMiles: 9, sortOrder: 0 }),
    hostRow({ id: "8", businessName: "Hospital Too Far", category: "hospital", distanceMiles: 11, sortOrder: 0 }),
    hostRow({ id: "9", businessName: "Gas OK", category: "gas", distanceMiles: 5, sortOrder: 0 }),
    hostRow({ id: "10", businessName: "Gas Too Far", category: "gas", distanceMiles: 6, sortOrder: 0 }),
  ];

  const restaurants = selectGuestGuideRows(rows, "restaurant");
  assert(restaurants.length === 3, "guest guide must cap at three");
  assert(
    restaurants.every((row) => ["La Sandwicherie", "Puerto Sagua", "Null Distance Spot"].includes(row.businessName)),
    "inactive, over-radius, and fourth rows must be excluded; null distance allowed",
  );
  assert(restaurants.every((row) => row.source === "host"), "guest rows must stay host-sourced");
  assert(!restaurants.some((row) => row.businessName === "Inactive Cafe"), "inactive entries must be excluded");
  assert(!restaurants.some((row) => row.businessName === "Too Far"), "restaurant radius 3 miles must apply");

  assert(selectGuestGuideRows(rows, "hospital").map((row) => row.businessName).join() === "Hospital Far", "hospital radius 10 miles");
  assert(selectGuestGuideRows(rows, "gas").map((row) => row.businessName).join() === "Gas OK", "gas radius 5 miles");

  const hostDecision = nearbyFromHostOrGoogle(restaurants);
  assert(hostDecision.fetchGoogle === false && hostDecision.source === "host", "host results must skip Google");
  const googleDecision = nearbyFromHostOrGoogle([]);
  assert(googleDecision.fetchGoogle === true && googleDecision.source === "google", "empty host list may fetch Google");

  const spokenEn = formatHostGuideSpeech(restaurants, "en");
  const spokenEs = formatHostGuideSpeech(
    [
      hostRow({ id: "1", businessName: "La Sandwicherie", distanceMiles: 0.5 }),
      hostRow({ id: "2", businessName: "Puerto Sagua", distanceMiles: 1, websiteOrMapsLink: "https://maps.example/sagua" }),
    ],
    "es",
  );
  assert(spokenEn.includes("La Sandwicherie") && spokenEn.includes("Puerto Sagua"), "host names may be spoken");
  assert(spokenEn.startsWith("Your host recommends"), "English host speech prefix");
  assert(spokenEs === "Tu anfitrión recomienda La Sandwicherie, a media milla, y Puerto Sagua, a una milla.", "Spanish host speech");
  assert(!/https?:\/\//i.test(spokenEs), "host links must never appear in spokenText");
  assert(!spokenEs.toLowerCase().includes("maps.example"), "host URLs must not be spoken");

  assert(isMissingLocalGuideTable({ code: "42P01" }), "missing table 42P01");
  assert(isMissingLocalGuideTable({ code: "PGRST205" }), "missing table PGRST205");
  assert(isMissingLocalGuideTable({ message: "Could not find the table 'public.property_local_guide' in the schema cache" }), "schema cache miss");
  assert(!isMissingLocalGuideTable({ code: "42501", message: "permission denied" }), "other errors are not missing-table");
}

const isDirectRun = process.argv[1]?.includes("local-guide-shared");
if (isDirectRun) {
  try {
    runLocalGuideSharedTests();
    console.log("local-guide-shared tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "local-guide-shared tests failed");
    process.exitCode = 1;
  }
}
