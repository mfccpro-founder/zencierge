import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const middleware = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

assert(middleware.includes("redirectWithAuthCookies"), "auth redirects use a cookie-preserving helper");
assert(
  middleware.includes("authResponse.cookies.getAll()"),
  "all refreshed Supabase cookie chunks are copied",
);
assert(
  middleware.includes("redirect.cookies.set(cookie)"),
  "cookie values and options are preserved on redirect",
);
assert.equal(
  (middleware.match(/return redirectWithAuthCookies\(/g) ?? []).length,
  3,
  "every authenticated middleware redirect preserves refreshed cookies",
);
assert(middleware.includes("supabase.auth.getUser()") === false, "identity lookup remains delegated");

const session = readFileSync(join(process.cwd(), "src/lib/supabase-auth-session.ts"), "utf8");
assert(session.includes("supabase.auth.getUser()"), "server still validates identity with getUser");

console.log("middleware auth cookie propagation tests passed");
