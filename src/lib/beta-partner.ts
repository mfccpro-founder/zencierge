type MetaUser = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
} | null | undefined;

function meta(user: MetaUser) {
  return { ...(user?.app_metadata ?? {}), ...(user?.user_metadata ?? {}) };
}

export function isBetaFounderPartner(user: MetaUser) {
  if (!user) return false;
  const data = meta(user);
  if (data.beta_partner === true || data.beta_partner === "1" || data.founder_partner === true) return true;
  const email = user.email?.toLowerCase() ?? "";
  const allow = (process.env.BETA_PARTNER_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && allow.includes(email));
}

export function betaPartnerTrial(user: MetaUser) {
  const data = meta(user);
  const endsAt = typeof data.trial_ends_at === "string" ? data.trial_ends_at : "";
  const end = Date.parse(endsAt);
  const active =
    isBetaFounderPartner(user) &&
    (data.beta_trial_active === true || (Number.isFinite(end) && end > Date.now()) || !endsAt);
  return { active, endsAt: endsAt || null };
}
