function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function isLoopbackHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Local development hosts (loopback and private LAN). Microphone should still be attempted. */
export function isPrivateNetworkHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopbackHostname(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

function envOriginRaw() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_SECURE_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    ""
  ).trim();
}

/** Accepts https://host, http://host, or a bare hostname (treated as HTTPS). */
export function normalizeConfiguredOrigin(raw: string): string | null {
  const trimmed = stripTrailingSlash(raw.trim());
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return stripTrailingSlash(url.origin);
  } catch {
    return null;
  }
}

export function isHttpsOrigin(origin: string) {
  return origin.toLowerCase().startsWith("https://");
}

/** Origin from NEXT_PUBLIC_BASE_URL (and aliases). Used for QR, guest links, and APIs. */
export function configuredPublicOrigin(): string | null {
  return normalizeConfiguredOrigin(envOriginRaw());
}

/** HTTPS origin only. Null when unset or when env is HTTP. */
export function configuredSecureOrigin(): string | null {
  const origin = configuredPublicOrigin();
  if (!origin || !isHttpsOrigin(origin)) return null;
  return origin;
}

export function configuredPublicHostname(): string | null {
  const origin = configuredPublicOrigin();
  if (!origin) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/**
 * Public origin for guest-facing URLs and API bases.
 * When NEXT_PUBLIC_BASE_URL (or an alias) is set, that value is always used —
 * localhost and LAN IPs are never substituted.
 */
export function resolvePublicAppOrigin(): string {
  const configured = configuredPublicOrigin();
  if (configured) return configured;
  if (typeof window !== "undefined") {
    return stripTrailingSlash(window.location.origin);
  }
  return "";
}

export async function resolveReachableAppOrigin(): Promise<string> {
  const configured = configuredPublicOrigin();
  if (configured) return configured;

  if (typeof window === "undefined") return "";

  const current = stripTrailingSlash(window.location.origin);

  try {
    const response = await fetch("/api/runtime-origin", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as { origin?: string };
      if (typeof data.origin === "string" && data.origin.trim()) {
        return stripTrailingSlash(data.origin.trim());
      }
    }
  } catch {
    /* use the current page origin */
  }

  return current;
}

/** Absolute /api/... URL. On LAN/local IPs, stay same-origin to avoid CORS HTTP errors. */
export function publicApiUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined" && isPrivateNetworkHostname(window.location.hostname)) {
    return normalized;
  }
  const base = configuredPublicOrigin();
  if (!base) return normalized;
  return `${base}${normalized}`;
}

export function publicOriginFromRequest(request: Request) {
  return configuredPublicOrigin() ?? new URL(request.url).origin;
}

/**
 * Same path on the configured HTTPS origin. Used when the guest is on HTTP
 * so Tap to talk can move them to a secure context.
 */
export function samePathOnSecureOrigin(): string | null {
  if (typeof window === "undefined") return null;
  if (window.isSecureContext) return null;
  const secure = configuredSecureOrigin();
  if (!secure) return null;
  return `${secure}${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function guestPortalUrl(propertyId?: string) {
  const id = propertyId?.trim() || "prop-1";
  const base = resolvePublicAppOrigin();
  if (!base) return `/guest/${id}`;
  return `${base}/guest/${id}`;
}

export async function guestPortalUrlAsync(propertyId?: string) {
  const id = propertyId?.trim() || "prop-1";
  const base = await resolveReachableAppOrigin();
  if (!base) return `/guest/${id}`;
  return `${base}/guest/${id}`;
}

export function absoluteAppPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = resolvePublicAppOrigin();
  if (!base) return normalized;
  return `${base}${normalized}`;
}

export async function absoluteAppPathAsync(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = await resolveReachableAppOrigin();
  if (!base) return normalized;
  return `${base}${normalized}`;
}
