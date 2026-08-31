import { requireHostUser } from "@/lib/supabase-route";
import { loadSupplyBoard, saveSnapshot, saveSupplyLog, newSupplyLog } from "@/lib/property-supplies-server";
import {
  normalizeSnapshot,
  restockBelowThreshold,
  restockItem,
  isSupplySku,
  type PropertySupplySnapshot,
} from "@/lib/property-supplies";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get("propertyId")?.trim();
  const board = await loadSupplyBoard(propertyId ? [propertyId] : undefined);
  return Response.json(board);
}

export async function PUT(request: Request) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;

  let body: {
    snapshot?: PropertySupplySnapshot;
    propertyId?: string;
    restockSku?: string;
    restockAllLow?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const board = await loadSupplyBoard();
  const current =
    board.snapshots.find((row) => row.propertyId === (body.snapshot?.propertyId || body.propertyId)) ??
    (body.snapshot ? normalizeSnapshot(body.snapshot) : null);
  if (!current && !body.snapshot) {
    return Response.json({ error: "propertyId is required" }, { status: 400 });
  }

  let next = body.snapshot ? normalizeSnapshot(body.snapshot) : current!;
  if (!body.snapshot) {
    if (body.restockAllLow) next = restockBelowThreshold(next);
    if (body.restockSku && isSupplySku(body.restockSku)) next = restockItem(next, body.restockSku);
  }

  const persisted = await saveSnapshot(next);
  const log = newSupplyLog({
    propertyId: next.propertyId,
    eventType: "restock",
    staffName: auth.user?.email ?? "host",
    reservationId: null,
    missingSkus: [],
    notes: body.restockAllLow
      ? "Quick restock: items below min threshold"
      : body.restockSku
        ? `Quick restock: ${body.restockSku}`
        : "Inventory adjusted",
  });
  await saveSupplyLog(log);

  return Response.json({ snapshot: next, log, persisted: persisted ? "supabase" : "local" });
}
