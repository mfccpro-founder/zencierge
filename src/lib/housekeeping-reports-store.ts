import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { HostAlert, HousekeepingReport } from "@/lib/housekeeping-photos";

type Memory = {
  reports: HousekeepingReport[];
  alerts: HostAlert[];
};

const globalKey = "__zenciergeHousekeepingReports" as const;

function memory(): Memory {
  const g = globalThis as typeof globalThis & { [globalKey]?: Memory };
  if (!g[globalKey]) g[globalKey] = { reports: [], alerts: [] };
  return g[globalKey];
}

function dataFile() {
  return path.join(process.cwd(), ".data", "housekeeping-reports.json");
}

function loadDisk(): Memory | null {
  try {
    const raw = fs.readFileSync(dataFile(), "utf8");
    const parsed = JSON.parse(raw) as Memory;
    if (!Array.isArray(parsed.reports) || !Array.isArray(parsed.alerts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDisk(state: Memory) {
  try {
    const dir = path.dirname(dataFile());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dataFile(), JSON.stringify(state, null, 2), "utf8");
  } catch (cause) {
    console.warn("[housekeeping] could not persist reports to disk", cause);
  }
}

function syncFromDisk() {
  const state = memory();
  if (state.reports.length || state.alerts.length) return state;
  const disk = loadDisk();
  if (disk) {
    state.reports = disk.reports;
    state.alerts = disk.alerts;
  }
  return state;
}

export function listHousekeepingReports(propertyId?: string) {
  const state = syncFromDisk();
  const rows = [...state.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!propertyId) return rows;
  return rows.filter((row) => row.propertyId === propertyId);
}

export function saveHousekeepingReport(report: HousekeepingReport) {
  const state = syncFromDisk();
  state.reports.unshift(report);
  saveDisk(state);
  return report;
}

export function listHostAlerts() {
  const state = syncFromDisk();
  return [...state.alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
}

export function pushHostAlert(partial: Omit<HostAlert, "id" | "createdAt"> & { id?: string; createdAt?: string }) {
  const state = syncFromDisk();
  const alert: HostAlert = {
    id: partial.id ?? randomUUID(),
    createdAt: partial.createdAt ?? new Date().toISOString(),
    kind: partial.kind,
    title: partial.title,
    body: partial.body,
    href: partial.href,
    reportId: partial.reportId,
    propertyId: partial.propertyId,
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 80);
  saveDisk(state);
  return alert;
}

export function localPhotoDir() {
  return path.join(process.cwd(), "public", "uploads", "housekeeping");
}
