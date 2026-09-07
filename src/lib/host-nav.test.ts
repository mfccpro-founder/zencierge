import {
  HOST_NAV_SECTIONS,
  flattenHostNavItems,
  guideableHostNavItems,
  isUserGuideNavItem,
} from "./host-nav";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runHostNavTests() {
  const items = flattenHostNavItems();
  const ids = items.map((item) => item.id);
  assert(new Set(ids).size === ids.length, "nav item ids must be unique");

  const legal = HOST_NAV_SECTIONS.find((section) => section.id === "legal");
  assert(Boolean(legal), "legal section missing");
  assert(
    legal!.items.every((item) => item.id !== "user-guide" && !item.href.includes("/dashboard/guide")),
    "Legal must not contain User Guide",
  );
  assert(legal!.items.some((item) => item.id === "laws"), "Legal must contain Laws");

  const guideIndex = HOST_NAV_SECTIONS.findIndex((section) => section.id === "guide");
  const settingsIndex = HOST_NAV_SECTIONS.findIndex((section) => section.id === "settings");
  assert(guideIndex >= 0 && settingsIndex === guideIndex + 1, "User Guide must be standalone immediately before Settings");
  assert(HOST_NAV_SECTIONS[guideIndex]?.standalone === true, "User Guide section must be standalone");
  assert(HOST_NAV_SECTIONS[settingsIndex]?.standalone === true, "Settings section must be standalone");

  const guideable = guideableHostNavItems();
  assert(guideable.length === 16, `expected 16 guideable routes, got ${guideable.length}`);
  assert(!guideable.some(isUserGuideNavItem), "guideable list must exclude User Guide");
  assert(
    guideable.every((item) => item.href !== "/dashboard/guide"),
    "guideable hrefs must not include the User Guide route",
  );

  const elena = guideable.find((item) => item.id === "elena-voice");
  const qr = guideable.find((item) => item.id === "guest-qr");
  assert(elena?.href === "/dashboard/voice-agent", "Elena Voice href");
  assert(qr?.href === "/dashboard/voice-agent?tab=guest-qr", "Guest QR href");
  assert(elena!.id !== qr!.id, "query-tab routes must have distinct ids");

  const hk = ["housekeeping", "photo-reports", "supplies", "team-cleaners"].map((id) =>
    guideable.find((item) => item.id === id),
  );
  assert(hk.every(Boolean), "housekeeping tab routes missing");
  assert(new Set(hk.map((item) => item!.href)).size === 4, "housekeeping hrefs must be distinct");
}

const isDirectRun = process.argv[1]?.includes("host-nav.test");
if (isDirectRun) {
  try {
    runHostNavTests();
    console.log("host-nav tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "host-nav tests failed");
    process.exitCode = 1;
  }
}
