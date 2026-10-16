import "server-only";

import { NextRequest } from "next/server";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseHostOwnershipStore } from "@/lib/host-property-ownership";
import {
  createSupabaseGuestServiceRequestStore,
  listHostServiceRequests,
  updateHostServiceRequest,
  type GuestServiceRequestStatus,
} from "@/lib/guest-service-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function context() {
  const auth = await requireHostAuthContext();
  if (auth.error) return { error: auth.error } as const;
  const admin = tryCreateSupabaseAdminClient();
  if (!admin || !auth.source) return { error: json({ error: "unavailable" }, 503) } as const;
  return {
    auth: { userId: auth.user?.id, source: auth.source },
    ownershipStore: createSupabaseHostOwnershipStore(admin),
    store: createSupabaseGuestServiceRequestStore(admin),
  } as const;
}

export async function GET() {
  const ctx = await context();
  if ("error" in ctx) return ctx.error;
  try {
    const result = await listHostServiceRequests(ctx);
    return json(result.body, result.status);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > 2048) return json({ error: "invalid" }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid" }, 400);
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes("id") || !keys.includes("status")) return json({ error: "invalid" }, 400);
  const id = typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id.trim() : "";
  const status = (body as { status?: unknown }).status;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["assigned", "in_progress", "completed", "needs_attention"].includes(String(status))) return json({ error: "invalid" }, 400);
  const ctx = await context();
  if ("error" in ctx) return ctx.error;
  try {
    const result = await updateHostServiceRequest({ ...ctx, id, nextStatus: status as GuestServiceRequestStatus });
    return json(result.body, result.status);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

