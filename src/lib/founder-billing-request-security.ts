export type FounderBillingRequestSecurityResult =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 415;
      error: "Forbidden" | "Content-Type must be application/json";
    };

function forbidden(): FounderBillingRequestSecurityResult {
  return {
    ok: false,
    status: 403,
    error: "Forbidden",
  };
}

function unsupportedMediaType(): FounderBillingRequestSecurityResult {
  return {
    ok: false,
    status: 415,
    error: "Content-Type must be application/json",
  };
}

function parsedOrigin(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isJsonContentType(value: string | null | undefined) {
  if (typeof value !== "string") return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

export function validateFounderBillingMutationRequest(input: {
  requestUrl: string;
  origin: string | null;
  contentType: string | null;
  secFetchSite: string | null;
}): FounderBillingRequestSecurityResult {
  let requestOrigin: string;
  try {
    requestOrigin = new URL(input.requestUrl).origin;
  } catch {
    return forbidden();
  }

  const origin = parsedOrigin(input.origin);
  if (!origin || origin !== requestOrigin) return forbidden();

  if (
    input.secFetchSite !== null &&
    input.secFetchSite.trim().toLowerCase() !== "same-origin"
  ) {
    return forbidden();
  }

  if (!isJsonContentType(input.contentType)) {
    return unsupportedMediaType();
  }

  return { ok: true };
}