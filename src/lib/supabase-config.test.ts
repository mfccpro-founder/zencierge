import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isValidSupabaseAnonKey,
  isValidSupabaseJwt,
  isValidSupabaseLegacyJwt,
  isValidSupabasePublishableKey,
  isValidSupabaseSecretKey,
  isValidSupabaseServiceRoleKey,
} from "./supabase-config";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const SYNTHETIC_JWT = "eyJhbGciOiJIUzI1NiJ.eyJyb2xlIjoiYW5vbiIsInRlc3Qi.dGVzdHNpZ25hdHVyZXh4";
const SYNTHETIC_PUBLISHABLE = `sb_publishable_${"a".repeat(24)}`;
const SYNTHETIC_SECRET = `sb_secret_${"b".repeat(24)}`;
const SYNTHETIC_OTHER = "not-a-supabase-key-format-value";

export function runSupabaseConfigTests() {
  assert(isValidSupabaseLegacyJwt(SYNTHETIC_JWT), "legacy JWT accepted");
  assert(isValidSupabaseAnonKey(SYNTHETIC_JWT), "public accepts legacy JWT");
  assert(isValidSupabaseAnonKey(SYNTHETIC_PUBLISHABLE), "public accepts synthetic publishable");
  assert(isValidSupabasePublishableKey(SYNTHETIC_PUBLISHABLE), "publishable helper");
  assert(!isValidSupabaseAnonKey(SYNTHETIC_SECRET), "public rejects secret");
  assert(!isValidSupabaseAnonKey(SYNTHETIC_OTHER), "public rejects other");
  assert(!isValidSupabaseAnonKey(""), "public rejects empty");
  assert(!isValidSupabaseAnonKey("placeholder-anon-key"), "public rejects placeholder");
  assert(!isValidSupabaseAnonKey(` ${SYNTHETIC_PUBLISHABLE}`), "public rejects leading whitespace");
  assert(!isValidSupabaseAnonKey(`${SYNTHETIC_PUBLISHABLE} `), "public rejects trailing whitespace");
  assert(!isValidSupabaseAnonKey(`${SYNTHETIC_PUBLISHABLE}\n`), "public rejects newline contamination");
  assert(!isValidSupabaseAnonKey("sb_publishable"), "public rejects malformed prefix");
  assert(!isValidSupabaseAnonKey("sb_publishable_"), "public rejects empty publishable body");
  assert(!isValidSupabaseAnonKey(`sb-publishable_${"a".repeat(24)}`), "public rejects hyphenated prefix");
  assert(!isValidSupabasePublishableKey(SYNTHETIC_SECRET), "publishable helper rejects secret");

  assert(isValidSupabaseServiceRoleKey(SYNTHETIC_JWT), "service accepts legacy JWT");
  assert(isValidSupabaseServiceRoleKey(SYNTHETIC_SECRET), "service accepts synthetic secret");
  assert(isValidSupabaseSecretKey(SYNTHETIC_SECRET), "secret helper");
  assert(!isValidSupabaseServiceRoleKey(SYNTHETIC_PUBLISHABLE), "service rejects publishable");
  assert(!isValidSupabaseServiceRoleKey(SYNTHETIC_OTHER), "service rejects other");
  assert(!isValidSupabaseServiceRoleKey(""), "service rejects empty");
  assert(!isValidSupabaseServiceRoleKey("your-service-role-key"), "service rejects placeholder");
  assert(!isValidSupabaseServiceRoleKey(` ${SYNTHETIC_SECRET}`), "service rejects leading whitespace");
  assert(!isValidSupabaseServiceRoleKey(`${SYNTHETIC_SECRET}\n`), "service rejects newline contamination");
  assert(!isValidSupabaseServiceRoleKey("sb_secret"), "service rejects malformed prefix");
  assert(!isValidSupabaseServiceRoleKey("sb_secret_"), "service rejects empty secret body");
  assert(!isValidSupabaseSecretKey(SYNTHETIC_PUBLISHABLE), "secret helper rejects publishable");

  assert(isValidSupabaseJwt(SYNTHETIC_SECRET) && !isValidSupabaseJwt(SYNTHETIC_PUBLISHABLE), "jwt alias is service validator");
  assert(isValidSupabaseAnonKey(SYNTHETIC_PUBLISHABLE) && !isValidSupabaseServiceRoleKey(SYNTHETIC_PUBLISHABLE), "keys are not interchangeable");
  assert(isValidSupabaseServiceRoleKey(SYNTHETIC_SECRET) && !isValidSupabaseAnonKey(SYNTHETIC_SECRET), "secret is not a public key");

  const root = join(process.cwd(), "src", "lib");
  const configSource = readFileSync(join(root, "supabase-config.ts"), "utf8");
  assert(configSource.includes("isValidSupabasePublishableKey") && configSource.includes("isValidSupabaseLegacyJwt"), "public path keeps legacy JWT plus publishable");
  assert(configSource.includes("isValidSupabaseSecretKey"), "service secret helper exists");

  const adminSource = readFileSync(join(root, "supabase-admin.ts"), "utf8");
  assert(adminSource.includes("isValidSupabaseServiceRoleKey"), "admin helper uses service validator");
  assert(!adminSource.includes("isValidSupabaseAnonKey"), "admin helper does not use public validator");
  assert(!adminSource.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"), "admin module does not read the public key");
}

const isDirectRun = process.argv[1]?.includes("supabase-config.test");
if (isDirectRun) {
  try {
    runSupabaseConfigTests();
    console.log("supabase-config tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "supabase-config tests failed");
    process.exitCode = 1;
  }
}
