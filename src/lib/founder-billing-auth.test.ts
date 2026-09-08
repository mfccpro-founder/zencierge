import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isFounderBillingOperator,
  type FounderBillingAuthUser,
} from "./founder-billing-auth";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function user(input: {
  email?: string | null;
  appRole?: unknown;
  userRole?: unknown;
}): FounderBillingAuthUser {
  return {
    email: input.email ?? null,
    app_metadata:
      input.appRole === undefined ? {} : { role: input.appRole },
    user_metadata:
      input.userRole === undefined ? {} : { role: input.userRole },
  };
}

function authorized(
  authUser: FounderBillingAuthUser | null,
  source: "supabase-auth" | "dev-fallback" | null,
  adminEmails: readonly string[] = [],
) {
  return isFounderBillingOperator({
    user: authUser,
    source,
    adminEmails,
  });
}

function runFounderBillingAuthTests() {
  assert(
    authorized(user({ appRole: "SUPER_ADMIN" }), "supabase-auth"),
    "server-controlled SUPER_ADMIN is authorized",
  );
  assert(
    authorized(user({ appRole: "superadmin" }), "supabase-auth"),
    "server-controlled SUPERADMIN is case insensitive",
  );
  assert(
    authorized(user({ appRole: "super-admin" }), "supabase-auth"),
    "server-controlled SUPER_ADMIN separator is normalized",
  );
  assert(
    !authorized(user({ appRole: "ADMIN" }), "supabase-auth"),
    "generic ADMIN app role is rejected",
  );
  assert(
    !authorized(user({ appRole: "owner" }), "supabase-auth"),
    "unknown app role is rejected",
  );

  assert(
    authorized(
      user({ email: "founder@example.com" }),
      "supabase-auth",
      ["founder@example.com"],
    ),
    "exact server allowlist email is authorized",
  );
  assert(
    authorized(
      user({ email: "Founder@Example.com" }),
      "supabase-auth",
      [" founder@example.com "],
    ),
    "allowlist comparison normalizes case and whitespace",
  );
  assert(
    !authorized(
      user({ email: "other-founder@example.com" }),
      "supabase-auth",
      ["founder@example.com"],
    ),
    "partial email match is rejected",
  );
  assert(
    !authorized(
      user({ email: null }),
      "supabase-auth",
      ["founder@example.com"],
    ),
    "missing authenticated email is rejected",
  );
  assert(
    !authorized(
      user({ email: "founder@example.com" }),
      "supabase-auth",
      [],
    ),
    "empty allowlist without server role is rejected",
  );

  assert(
    !authorized(user({ userRole: "superadmin" }), "supabase-auth"),
    "user_metadata superadmin role is rejected",
  );
  assert(
    !authorized(user({ userRole: "admin" }), "supabase-auth"),
    "user_metadata admin role is rejected",
  );
  assert(
    !authorized(
      user({ appRole: "host", userRole: "SUPER_ADMIN" }),
      "supabase-auth",
    ),
    "user metadata cannot elevate an untrusted app role",
  );
  assert(
    authorized(
      user({ appRole: "SUPER_ADMIN", userRole: "host" }),
      "supabase-auth",
    ),
    "user metadata cannot override a trusted app role",
  );

  assert(
    !authorized(user({ appRole: "SUPER_ADMIN" }), "dev-fallback"),
    "dev fallback cannot use a server role",
  );
  assert(
    !authorized(
      user({ email: "founder@example.com" }),
      "dev-fallback",
      ["founder@example.com"],
    ),
    "dev fallback cannot use an allowlisted email",
  );
  assert(
    !authorized(user({ appRole: "SUPER_ADMIN" }), null),
    "missing auth source is rejected",
  );
  assert(!authorized(null, "supabase-auth"), "missing user is rejected");

  const route = readFileSync(
    join(
      process.cwd(),
      "src/app/api/backoffice/customers/[id]/complimentary/route.ts",
    ),
    "utf8",
  );
  assert(
    route.includes("isFounderBillingOperator"),
    "complimentary route uses strict Founder Billing policy",
  );
  assert(
    route.includes("source: auth.source"),
    "complimentary route passes auth provenance",
  );
  assert(
    !route.includes("isSuperAdmin"),
    "complimentary route does not fall back to broad superadmin policy",
  );
  assert(
    route.includes("applyComplimentaryAccess"),
    "existing complimentary mutation remains wired",
  );
  assert(
    !route.includes("SquareClient") &&
      !route.includes("createSquareClient"),
    "authorization microblock adds no Square SDK operations",
  );

  console.log("founder billing authorization tests passed");
}

runFounderBillingAuthTests();