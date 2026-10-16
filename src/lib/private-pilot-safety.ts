const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

type PilotEnvironment = {
  [key: string]: string | undefined;
  ZENCIERGE_PRIVATE_PILOT_SAFE_MODE?: string;
  ZENCIERGE_PRIVATE_PILOT_HOST_IDS?: string;
};

export function privatePilotSafeMode(env: PilotEnvironment = process.env) {
  return TRUE_VALUES.has((env.ZENCIERGE_PRIVATE_PILOT_SAFE_MODE ?? "").trim().toLowerCase());
}

export const PRIVATE_PILOT_BLOCKED_PREFIXES = [
  "/signup", "/admin", "/backoffice", "/centro", "/api/admin", "/api/backoffice", "/api/finance",
  "/api/checkout", "/api/payments/square", "/api/dev/stripe-sandbox", "/api/webhooks/square",
  "/api/webhooks/subscriptions", "/api/inbound", "/api/housekeeping/reports",
  "/api/housekeeping/upload", "/housekeeping/upload", "/api/auth/pending-host",
  "/api/auth/dev-session",
] as const;

export function privatePilotBlockedPath(pathname: string) {
  return PRIVATE_PILOT_BLOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function privatePilotHostIds(env: PilotEnvironment = process.env) {
  return new Set(
    (env.ZENCIERGE_PRIVATE_PILOT_HOST_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  );
}

export function isPrivatePilotHost(userId: string | null | undefined, env: PilotEnvironment = process.env) {
  return Boolean(userId) && privatePilotSafeMode(env) && privatePilotHostIds(env).has(userId!);
}

/** Fail closed for authenticated host surfaces while the private pilot is enabled. */
export function privatePilotHostAuthorized(
  userId: string | null | undefined,
  env: PilotEnvironment = process.env,
) {
  return !privatePilotSafeMode(env) || isPrivatePilotHost(userId, env);
}
