export type PropertyWriteIdentity = {
  id: string;
  name: string;
  city: string;
};

export type PropertyWriteIdentityResult =
  | { ok: true; value: PropertyWriteIdentity }
  | { ok: false; error: string };

export function validatePropertyWriteIdentity(body: unknown): PropertyWriteIdentityResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Property id, name, and city are required" };
  }

  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.city !== "string"
  ) {
    return { ok: false, error: "Property id, name, and city are required" };
  }

  const value = {
    id: candidate.id.trim(),
    name: candidate.name.trim(),
    city: candidate.city.trim(),
  };
  if (!value.id || !value.name || !value.city) {
    return { ok: false, error: "Property id, name, and city are required" };
  }
  if (value.id.length > 200 || value.name.length > 200 || value.city.length > 120) {
    return { ok: false, error: "Property id, name, or city is too long" };
  }
  return { ok: true, value };
}
