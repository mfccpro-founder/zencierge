import { requireHostUser } from "@/lib/supabase-route";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadHostListings } from "@/lib/host-listings-server";
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
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });
  const listings = await loadHostListings(admin, auth.user.id);
  if (listings.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const url = new URL(request.url);
  const propertyId = url.searchParams.get("propertyId")?.trim();
  if (propertyId && !listings.properties.some((property) => property.id === propertyId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const board = await loadSupplyBoard(listings.properties, propertyId ? [propertyId] : undefined);
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

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });
  const listings = await loadHostListings(admin, auth.user.id);
  if (listings.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const board = await loadSupplyBoard(listings.properties);
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
