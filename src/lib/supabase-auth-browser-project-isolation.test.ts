import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/lib/supabase-auth-browser.ts"), "utf8");

assert(source.includes("isSingleton: false"), "the package-global Supabase browser singleton is disabled");
assert(source.includes("__zenciergeAuthBrowserUrl"), "the app singleton records its project URL");
assert(
  source.includes("globalForAuth.__zenciergeAuthBrowserUrl !== SUPABASE_URL"),
  "a project URL change invalidates the app singleton",
);

console.log("Supabase browser project isolation tests passed");
