import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isSuperAdmin } from "./admin-auth";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function user(input: {
  email?: string | null;
  appRole?: unknown;
  userRole?: unknown;
  provider?: string;
}): User {
  return {
    email: input.email ?? null,
    app_metadata: {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.appRole === undefined ? {} : { role: input.appRole }),
    },
    user_metadata: input.userRole === undefined ? {} : { role: input.userRole },
  } as User;
}

function runAdminAuthTests() {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "founder@example.com";
  try {
    assert(isSuperAdmin(user({ appRole: "SUPER_ADMIN" })), "server app_metadata SUPER_ADMIN is authorized");
    assert(isSuperAdmin(user({ appRole: "superadmin" })), "server app_metadata SUPERADMIN is authorized");
    assert(isSuperAdmin(user({ appRole: "ADMIN" })), "server app_metadata ADMIN is authorized");
    assert(
      isSuperAdmin(user({ appRole: "SUPER_ADMIN", userRole: "host" })),
      "user_metadata cannot override a server role",
    );
    assert(!isSuperAdmin(user({ userRole: "superadmin" })), "user_metadata superadmin is rejected");
    assert(!isSuperAdmin(user({ userRole: "admin" })), "user_metadata admin is rejected");
    assert(!isSuperAdmin(user({ userRole: "SUPER_ADMIN" })), "user_metadata SUPER_ADMIN is rejected");
    assert(
      !isSuperAdmin(user({ appRole: "host", userRole: "SUPER_ADMIN" })),
      "user_metadata cannot elevate an untrusted app role",
    );
    assert(
      isSuperAdmin(user({ email: "Founder@Example.com" })),
      "verified auth email on ADMIN_EMAILS is authorized",
    );
    assert(
      !isSuperAdmin(user({ email: "founder@example.com", provider: "pending_signup" })),
      "pending-signup cookie cannot use the allowlist",
    );
    assert(
      !isSuperAdmin(user({ email: "founder@example.com", provider: "dev" })),
      "dev-host cookie cannot use the allowlist",
    );
    assert(
      !isSuperAdmin(user({ appRole: "SUPER_ADMIN", provider: "dev" })),
      "dev-host cookie cannot use a server role",
    );
    assert(!isSuperAdmin(null), "missing user is rejected");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }

  const root = process.cwd();
  const auth = readFileSync(join(root, "src/lib/admin-auth.ts"), "utf8");
  const session = readFileSync(join(root, "src/lib/supabase-auth-session.ts"), "utf8");
  const route = readFileSync(join(root, "src/lib/supabase-route.ts"), "utf8");
  const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
  const layout = readFileSync(join(root, "src/app/(founder-admin)/backoffice/layout.tsx"), "utf8");

  assert(!/user\.user_metadata|user_metadata\?/.test(auth), "isSuperAdmin does not read user_metadata");
  assert(auth.includes("app_metadata?.role"), "isSuperAdmin reads the server role");
  assert(auth.includes("adminEmailAllowlist"), "isSuperAdmin keeps the server email allowlist");
  assert(session.includes("supabase.auth.getUser()"), "middleware identity comes from getUser()");
  assert(route.includes("supabase.auth.getUser()"), "route identity comes from getUser()");
  assert(middleware.includes("updateAuthSession"), "founder middleware uses the verified session");
  assert(layout.includes("requireHostUser"), "back office layout uses the verified host user");
  assert(layout.includes("isSuperAdmin"), "back office layout keeps isSuperAdmin");

  console.log("admin-auth tests passed");
}

runAdminAuthTests();
