const FALLBACK_HOST_NAME = "Javier";

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
