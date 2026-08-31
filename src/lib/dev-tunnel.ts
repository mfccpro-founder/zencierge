import fs from "node:fs";
import path from "node:path";
import { isHttpsOrigin, normalizeConfiguredOrigin } from "@/lib/public-app-url";

export type DevTunnelRecord = {
  origin: string;
  provider: string;
  updatedAt: string;
};

export function devTunnelFilePath() {
  return path.join(process.cwd(), ".data", "dev-tunnel.json");
}

export function readDevTunnelOrigin(): string | null {
  try {
    const raw = fs.readFileSync(devTunnelFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DevTunnelRecord>;
    const origin = normalizeConfiguredOrigin(String(parsed.origin ?? ""));
    if (!origin || !isHttpsOrigin(origin)) return null;
    const ageMs = Date.now() - new Date(String(parsed.updatedAt ?? 0)).getTime();
    if (Number.isFinite(ageMs) && ageMs > 12 * 60 * 60 * 1000) return null;
    return origin;
  } catch {
    return null;
  }
}

export function writeDevTunnelOrigin(origin: string, provider: string) {
  const normalized = normalizeConfiguredOrigin(origin);
  if (!normalized || !isHttpsOrigin(normalized)) return null;
  const dir = path.dirname(devTunnelFilePath());
  fs.mkdirSync(dir, { recursive: true });
  const record: DevTunnelRecord = {
    origin: normalized,
    provider,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(devTunnelFilePath(), JSON.stringify(record, null, 2), "utf8");
  return record;
}

export function clearDevTunnelOrigin() {
  try {
    fs.unlinkSync(devTunnelFilePath());
  } catch {
    /* already gone */
  }
}
