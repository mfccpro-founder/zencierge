import { loadSupplyBoard, newSupplyLog, saveSnapshot, saveSupplyLog } from "@/lib/property-supplies-server";
import {
  applyTurnoverCounts,
  isSupplySku,
  type TurnoverSupplyCount,
} from "@/lib/property-supplies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    propertyId?: string;
    reservationId?: string;
    staffName?: string;
    notes?: string;
    counts?: Array<{ sku?: string; remaining?: number; missing?: boolean }>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const propertyId = body.propertyId?.trim() ?? "";
  if (!propertyId) {
    return Response.json({ error: "propertyId is required" }, { status: 400 });
  }

  const counts: TurnoverSupplyCount[] = (body.counts ?? [])
    .filter((row): row is { sku: string; remaining?: number; missing?: boolean } => Boolean(row.sku && isSupplySku(row.sku)))
    .map((row) => ({
      sku: row.sku as TurnoverSupplyCount["sku"],
      remaining: Number(row.remaining) || 0,
      missing: Boolean(row.missing),
    }));

  if (!counts.length) {
    return Response.json({ error: "Add remaining counts for at least one consumable." }, { status: 400 });
  }

  const board = await loadSupplyBoard([propertyId]);
  const current = board.snapshots[0];
  if (!current) {
    return Response.json({ error: "Unknown property" }, { status: 404 });
  }

  const applied = applyTurnoverCounts(current, counts, {
    staffName: body.staffName,
  });
  const persisted = await saveSnapshot(applied.snapshot);
  const log = newSupplyLog({
    propertyId,
    eventType: "turnover",
    staffName: body.staffName?.trim() || null,
    reservationId: body.reservationId?.trim() || null,
    missingSkus: applied.missingSkus,
    notes: body.notes?.trim() || (applied.missingSkus.length ? `Missing: ${applied.missingSkus.join(", ")}` : "Turnover restock check"),
  });
  await saveSupplyLog(log);

  return Response.json({
    snapshot: applied.snapshot,
    log,
    missingSkus: applied.missingSkus,
    persisted: persisted ? "supabase" : "local",
  });
}
