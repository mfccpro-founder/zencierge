import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`./src/${specifier.slice(2)}.ts`, pathToFileURL(`${process.cwd()}/`)).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { addMonthsUtc, complimentaryEndsAtFromPreset } = await import("./complimentary-access-core.ts");

assert.equal(
  complimentaryEndsAtFromPreset(6, new Date("2026-08-31T15:45:00.000Z")),
  "2027-02-28T15:45:00.000Z",
  "six calendar months clamp to February's last valid day",
);
assert.equal(
  complimentaryEndsAtFromPreset(6, new Date("2027-08-31T15:45:00.000Z")),
  "2028-02-29T15:45:00.000Z",
  "six calendar months respect leap years",
);
assert.equal(
  addMonthsUtc(new Date("2026-10-15T12:30:00.000Z"), 6).toISOString(),
  "2027-04-15T12:30:00.000Z",
  "ordinary dates preserve day and UTC time",
);
console.log("Complimentary calendar-month tests passed");
