const FALLBACK_HOST_NAME = "Host";
export const DEFAULT_HOST_PROFILE_NAME = "Javier E Murphy";
export const HOST_PROFILE_NAME_KEY = "zencierge.hub.fullName";
export const HOST_PROFILE_UPDATED_EVENT = "zencierge-host-profile";

function metaString(meta: Record<string, unknown>, key: string) {
  const value = meta[key];
  return typeof value === "string" ? value.trim() : "";
}

export function hostDisplayName(user: {
  user_metadata?: Record<string, unknown>;
} | null): string {
  const meta = user?.user_metadata ?? {};
  const first = metaString(meta, "first_name") || metaString(meta, "given_name");
  if (first) return first.split(/\s+/)[0] ?? FALLBACK_HOST_NAME;

  const full = metaString(meta, "full_name") || metaString(meta, "name");
  if (full) return full.split(/\s+/)[0] ?? FALLBACK_HOST_NAME;

  return FALLBACK_HOST_NAME;
}

export function hostFullName(user: {
  user_metadata?: Record<string, unknown>;
} | null): string {
  const meta = user?.user_metadata ?? {};
  return (
    metaString(meta, "full_name") ||
    [metaString(meta, "first_name"), metaString(meta, "last_name")].filter(Boolean).join(" ") ||
    metaString(meta, "name") ||
    FALLBACK_HOST_NAME
  );
}

export function hostInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "JM";
  if (parts.length === 1) {
    return (parts[0].slice(0, 2) || "JM").toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase() || "JM";
}

export function readStoredHostProfileName() {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HOST_PROFILE_NAME_KEY) ?? "").trim();
}

export function writeStoredHostProfileName(name: string) {
  const value = name.trim();
  if (typeof window === "undefined") return value;
  window.localStorage.setItem(HOST_PROFILE_NAME_KEY, value);
  window.dispatchEvent(new CustomEvent(HOST_PROFILE_UPDATED_EVENT, { detail: value }));
  return value;
}

export function resolveHostProfileName(
  user: {
    user_metadata?: Record<string, unknown>;
  } | null,
  pendingFullName?: string,
) {
  const stored = readStoredHostProfileName();
  if (stored) return stored;
  const pending = pendingFullName?.trim() ?? "";
  if (pending) return pending;
  const fromAuth = hostFullName(user);
  if (fromAuth && fromAuth !== FALLBACK_HOST_NAME) return fromAuth;
  return DEFAULT_HOST_PROFILE_NAME;
}
