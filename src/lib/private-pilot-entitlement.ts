type PilotEntitlementEnvironment = {
  [key: string]: string | undefined;
  ZENCIERGE_PRIVATE_PILOT_SAFE_MODE?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function pilotModeEnabled(env: PilotEntitlementEnvironment) {
  return TRUE_VALUES.has((env.ZENCIERGE_PRIVATE_PILOT_SAFE_MODE ?? "").trim().toLowerCase());
}

export function privatePilotDemoAccessGranted(
  input: { planId?: unknown; complimentaryEndsAt?: unknown },
  env: PilotEntitlementEnvironment = process.env,
  now = new Date(),
) {
  if (!pilotModeEnabled(env)) return true;
  if (input.planId !== "pro" || typeof input.complimentaryEndsAt !== "string") return false;
  const end = Date.parse(input.complimentaryEndsAt);
  return Number.isFinite(end) && end > now.getTime();
}
