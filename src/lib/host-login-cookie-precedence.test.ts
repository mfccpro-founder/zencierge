import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const source = readFileSync(
  join(process.cwd(), "src/components/auth/host-auth-form.tsx"),
  "utf8",
);
const loginStart = source.indexOf("const handleLogin");
const signIn = source.indexOf('fetch("/api/auth/password-login"', loginStart);
const clearDev = source.indexOf('fetch("/api/auth/dev-session", { method: "DELETE" })', loginStart);
const clearPending = source.indexOf('fetch("/api/auth/pending-host", { method: "DELETE" })', loginStart);
const fullNavigation = source.indexOf("window.location.assign(destination)", signIn);

assert(loginStart >= 0 && signIn > loginStart, "host password login uses the cookie-setting route");
assert(clearDev > loginStart && clearDev < signIn, "dev preview cookie is cleared before Supabase login");
assert(clearPending > loginStart && clearPending < signIn, "pending host cookie is cleared before Supabase login");
assert(source.includes("Promise.allSettled"), "cookie cleanup cannot turn an Auth attempt into a silent failure");
assert(fullNavigation > signIn, "successful Auth uses one full document navigation");
assert(
  !source.slice(signIn, source.indexOf("} catch", signIn)).includes("router.refresh();"),
  "successful Auth does not race destination navigation with router.refresh",
);

console.log("Host login cookie precedence tests passed");
