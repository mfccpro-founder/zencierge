/** Server-only versioned AI pricing. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("ai-pricing is server-only");
}

export type AiPricingUnit = "character" | "text_token" | "audio_token";
export type AiPricingOperation = "tts" | "stt" | "llm";
export type AiCostClass = "exact" | "pending";

export type AiPricingRule = {
  id: string;
  provider: string;
  model: string;
  operation: AiPricingOperation;
  unit: AiPricingUnit;
  /** USD per single unit (e.g. $0.0001 per character = $0.10 / 1k). */
  rate_usd: number;
  effective_from: string;
  effective_to: string | null;
  source_note: string;
};

/**
 * Approved seed rules (must match migration 20260905234500_ai_pricing_rules.sql).
 * Used for tests and as a write-path fallback when the DB table is unavailable.
 */
export const AI_PRICING_SEED_RULES: readonly AiPricingRule[] = [
  {
    id: "elevenlabs_multilingual_v2_char_2026_09",
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    operation: "tts",
    unit: "character",
    rate_usd: 0.0001,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: null,
    source_note: "ElevenLabs API TTS v2/v3 standard: $0.10 per 1,000 characters ($0.0001/char).",
  },
  {
    id: "elevenlabs_flash_char_2026_09",
    provider: "elevenlabs",
    model: "eleven_flash_v2_5",
    operation: "tts",
    unit: "character",
    rate_usd: 0.00005,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: null,
    source_note:
      "ElevenLabs Flash/Turbo API TTS: $0.05 per 1,000 characters. Seeded for future use; not on active Zencierge path.",
  },
  {
    id: "elevenlabs_turbo_char_2026_09",
    provider: "elevenlabs",
    model: "eleven_turbo_v2_5",
    operation: "tts",
    unit: "character",
    rate_usd: 0.00005,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: null,
    source_note:
      "ElevenLabs Flash/Turbo API TTS: $0.05 per 1,000 characters. Seeded for future use; not on active Zencierge path.",
  },
  {
    id: "openai_gpt4o_mini_tts_text_token_2026_09",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    operation: "tts",
    unit: "text_token",
    rate_usd: 0.0000006,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: null,
    source_note:
      "OpenAI gpt-4o-mini-tts text input: $0.60 / 1M text tokens. Not applied per-event until text tokens are metered.",
  },
  {
    id: "openai_gpt4o_mini_tts_audio_token_2026_09",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    operation: "tts",
    unit: "audio_token",
    rate_usd: 0.000012,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: null,
    source_note:
      "OpenAI gpt-4o-mini-tts audio output: $12 / 1M audio tokens. Not applied per-event until audio tokens are metered.",
  },
];

export function isPricingRuleEffectiveAt(rule: AiPricingRule, at: Date): boolean {
  const t = at.getTime();
  const from = Date.parse(rule.effective_from);
  if (!Number.isFinite(from) || t < from) return false;
  if (!rule.effective_to) return true;
  const to = Date.parse(rule.effective_to);
  return Number.isFinite(to) && t < to;
}

export function findEffectivePricingRule(input: {
  provider: string;
  model: string;
  operation: AiPricingOperation;
  unit: AiPricingUnit;
  at?: Date;
  rules?: readonly AiPricingRule[];
}): AiPricingRule | null {
  const at = input.at ?? new Date();
  const provider = input.provider.trim().toLowerCase();
  const model = input.model.trim();
  const rules = input.rules ?? AI_PRICING_SEED_RULES;
  const matches = rules
    .filter(
      (rule) =>
        rule.provider.toLowerCase() === provider &&
        rule.model === model &&
        rule.operation === input.operation &&
        rule.unit === input.unit &&
        isPricingRuleEffectiveAt(rule, at),
    )
    .sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from));
  return matches[0] ?? null;
}

/** Exact USD cents from a character-based rule. Never used for token-priced OpenAI TTS. */
export function calculateExactCharacterCostCents(input: {
  inputCharacters: number;
  rateUsdPerCharacter: number;
}): number {
  const chars = Math.max(0, Math.trunc(input.inputCharacters));
  if (!Number.isFinite(input.rateUsdPerCharacter) || input.rateUsdPerCharacter < 0) {
    throw new Error("invalid-rate");
  }
  return Math.round(chars * input.rateUsdPerCharacter * 100);
}

export type AiUsageCostResolution = {
  cost_class: AiCostClass | null;
  calculated_cost_cents: number | null;
  pricing_rule_id: string | null;
};

/**
 * Classify and optionally price a usage event.
 * OpenAI gpt-4o-mini-tts with characters only → pending (never invent token cost).
 */
export function resolveAiUsageEventCost(input: {
  provider: string;
  model: string;
  operation: AiPricingOperation;
  status: "success" | "failed";
  input_characters?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  at?: Date;
  rules?: readonly AiPricingRule[];
}): AiUsageCostResolution {
  if (input.status !== "success" || input.operation !== "tts") {
    return { cost_class: null, calculated_cost_cents: null, pricing_rule_id: null };
  }

  const provider = input.provider.trim().toLowerCase();
  const model = input.model.trim();
  const at = input.at ?? new Date();
  const rules = input.rules ?? AI_PRICING_SEED_RULES;

  const characterRule = findEffectivePricingRule({
    provider,
    model,
    operation: "tts",
    unit: "character",
    at,
    rules,
  });

  if (characterRule) {
    const chars =
      typeof input.input_characters === "number" && Number.isFinite(input.input_characters)
        ? Math.trunc(input.input_characters)
        : null;
    if (chars == null || chars < 0) {
      return { cost_class: "pending", calculated_cost_cents: null, pricing_rule_id: null };
    }
    return {
      cost_class: "exact",
      calculated_cost_cents: calculateExactCharacterCostCents({
        inputCharacters: chars,
        rateUsdPerCharacter: characterRule.rate_usd,
      }),
      pricing_rule_id: characterRule.id,
    };
  }

  // OpenAI TTS (and any non-character TTS): never invent cost from characters.
  if (provider === "openai" && model === "gpt-4o-mini-tts") {
    return { cost_class: "pending", calculated_cost_cents: null, pricing_rule_id: null };
  }

  return { cost_class: "pending", calculated_cost_cents: null, pricing_rule_id: null };
}

export function formatUsdFromCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

/**
 * Inspect whether an OpenAI Admin API credential is already configured.
 * Never logs or returns the secret value.
 */
export function getOpenAiActualSpendReconciliationStatus(): {
  configured: boolean;
  label: string;
  canReadOrgMonthlySpend: boolean;
  canAttributePerCustomerOrStay: boolean;
} {
  const configured = Boolean(
    process.env.OPENAI_ADMIN_KEY?.trim() ||
      process.env.OPENAI_ADMIN_API_KEY?.trim() ||
      process.env.OPENAI_ORGANIZATION_ADMIN_KEY?.trim(),
  );
  if (!configured) {
    return {
      configured: false,
      label: "OpenAI actual spend reconciliation: Not configured",
      canReadOrgMonthlySpend: false,
      canAttributePerCustomerOrStay: false,
    };
  }
  return {
    configured: true,
    label:
      "OpenAI Admin key present — org Usage/Costs API can reconcile account-level spend. Not used for per-customer or per-stay attribution.",
    canReadOrgMonthlySpend: true,
    canAttributePerCustomerOrStay: false,
  };
}
