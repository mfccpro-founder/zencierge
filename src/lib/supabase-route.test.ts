import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostAuthSourceFromBranch, requireHostUser } from "./supabase-route";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runSupabaseRouteTests() {
  assert(hostAuthSourceFromBranch("supabase-get-user") === "supabase-auth", "getUser branch is supabase-auth");
  assert(hostAuthSourceFromBranch("dev-host-cookie") === "dev-fallback", "dev-host cookie branch is dev-fallback");
  assert(hostAuthSourceFromBranch("pending") === "dev-fallback", "non-getUser local host is not supabase-auth");

  assert(typeof requireHostUser === "function", "requireHostUser remains exported for existing callers");

  const routeSource = readFileSync(join(process.cwd(), "src/lib/supabase-route.ts"), "utf8");
  assert(routeSource.includes("export async function requireHostUser"), "requireHostUser export preserved");
  assert(routeSource.includes("return requireHostAuthContext()"), "requireHostUser delegates without changing caller shape");
  assert(routeSource.includes("supabase.auth.getUser()"), "supabase-auth source comes from getUser");
  assert(routeSource.includes("hasDevHostCookie"), "dev-fallback source comes from the cookie branch");
  assert(!routeSource.includes("isMockDevHostUserId"), "auth module does not classify provenance by mock UUID");
}

const isDirectRun = process.argv[1]?.includes("supabase-route.test");
if (isDirectRun) {
  try {
    runSupabaseRouteTests();
    console.log("supabase-route tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "supabase-route tests failed");
    process.exitCode = 1;
  }
}
