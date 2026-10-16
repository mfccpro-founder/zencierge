import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveUsStrJurisdiction } from "./us-str-jurisdiction.ts";
import { LAWS_UI, localizeJurisdiction } from "./laws-regulations-i18n.ts";

const fixtures = [
  ["Miami Beach", "100 Collins Ave", "America/New_York"],
  ["Miami", "100 Brickell Ave", "America/New_York"],
  ["Sunny Isles Beach", "18000 Collins Ave", "America/New_York"],
  ["Fort Lauderdale", "100 Las Olas Blvd", "America/New_York"],
  ["Doral", "100 NW 36 St", "America/New_York"],
  ["Hollywood", "100 Ocean Dr", "America/New_York"],
  ["Boca Raton", "100 Federal Hwy", "America/New_York"],
  ["Tallahassee", "100 Main St", "America/New_York"],
  ["Austin", "100 Congress Ave", "America/Chicago"],
  ["Los Angeles", "100 Sunset Blvd", "America/Los_Angeles"],
  ["Denver", "100 Colfax Ave", "America/Denver"],
] as const;

for (const [city, address, timezone] of fixtures) {
  const original = resolveUsStrJurisdiction({ city, address, timezone });
  assert.ok(original, `${city}: covered fixture resolves a jurisdiction`);
  const english = localizeJurisdiction(original, "en");
  const spanish = localizeJurisdiction(original, "es");
  assert.equal(spanish, original, `${original.id}: Spanish preserves the jurisdiction source`);
  const figures = (value: string) => value.match(/\d+(?:\.\d+)?%?/g) ?? [];
  assert.deepEqual(english.taxRates.map((row) => figures(row.value)), original.taxRates.map((row) => figures(row.value)), `${original.id}: figures preserved`);
  assert.deepEqual(english.links.map((row) => row.href), original.links.map((row) => row.href), `${original.id}: official URLs preserved`);
  assert.equal(english.topics.length, original.topics.length, `${original.id}: topic count preserved`);
  assert.deepEqual(english.topics.map((topic) => topic.bullets.length), original.topics.map((topic) => topic.bullets.length), `${original.id}: bullet counts preserved`);
  const visibleEnglish = JSON.stringify(english);
  assert(!/\b(Zonificación|Impuestos turísticos|Según ciudad|Condado de|Ciudad de|Confirma con tu)\b/u.test(visibleEnglish), `${original.id}: no Spanish UI copy leaks into English`);
}

assert.equal(
  resolveUsStrJurisdiction({ city: "Madison", address: "1 Main Street", timezone: "America/New_York" }),
  null,
  "an uncovered location does not inherit Miami Beach or Florida guidance",
);

assert.equal(LAWS_UI.en.title, "Airbnb Regulations & Laws");
assert.equal(LAWS_UI.es.title, "Regulaciones y leyes de Airbnb");

const view = await readFile(new URL("../components/dashboard/laws-regulations-view.tsx", import.meta.url), "utf8");
assert(view.includes("subscribeHostGuideLang"), "laws page follows the shared EN/ES selector");
assert(view.includes("document.title = ui.browserTitle"), "browser title follows the selected language");
assert(view.includes("ui.unavailableLocation"), "uncovered locations show the explicit unavailable message");

console.log("laws regulations EN/ES: PASS");
