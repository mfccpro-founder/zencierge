import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { supabase } from "@/lib/supabase";
import {
  categoriesForNearbyKind,
  isMissingLocalGuideTable,
  LOCAL_GUIDE_LIMITS,
  sanitizeGuideLink,
  sanitizeGuideText,
  withinLocalGuideRadius,
  type LocalGuideCategory,
  type LocalGuidePublicResult,
  type LocalGuideHostRow,
  type LocalGuideWrite,
} from "@/lib/local-guide-shared";

export { sanitizeLocalGuideWrite } from "@/lib/local-guide-shared";

export type LocalGuideRow = LocalGuideHostRow;

type DbRow = {
  id: string;
  property_id: string;
  category: string;
  business_name: string;
  distance_miles: number | string | null;
  host_note: string | null;
  website_or_maps_link: string | null;
  active: boolean;
  sort_order: number;
};

function guideClient(client?: SupabaseClient | null) {
  return client ?? tryCreateSupabaseAdminClient() ?? supabase;
}

function toDistance(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10) / 10;
}

function toPublic(row: DbRow): LocalGuidePublicResult {
  return {
    id: row.id,
    category: row.category as LocalGuideCategory,
    businessName: sanitizeGuideText(row.business_name, LOCAL_GUIDE_LIMITS.businessName),
    distanceMiles: toDistance(row.distance_miles),
    hostNote: sanitizeGuideText(row.host_note ?? "", LOCAL_GUIDE_LIMITS.hostNote),
    websiteOrMapsLink: sanitizeGuideLink(row.website_or_maps_link ?? ""),
    source: "host",
  };
}

function toHostRow(row: DbRow): LocalGuideRow {
  return {
    ...toPublic(row),
    propertyId: row.property_id,
    active: Boolean(row.active),
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
  };
}

export async function loadActiveLocalGuide(
  propertyId: string,
  kind: string,
  client?: SupabaseClient | null,
): Promise<LocalGuidePublicResult[]> {
  const id = sanitizeGuideText(propertyId, LOCAL_GUIDE_LIMITS.propertyId);
  const categories = categoriesForNearbyKind(kind);
  if (!id || !categories.length) return [];
  try {
    const { data, error } = await guideClient(client)
      .from("property_local_guide")
      .select("id, property_id, category, business_name, distance_miles, host_note, website_or_maps_link, active, sort_order")
      .eq("property_id", id)
      .eq("active", true)
      .in("category", categories)
      .order("sort_order", { ascending: true })
      .order("business_name", { ascending: true });
    if (error) {
      if (isMissingLocalGuideTable(error)) return [];
      return [];
    }
    const rows = ((data ?? []) as DbRow[])
      .map(toPublic)
      .filter((row) => row.businessName && withinLocalGuideRadius(row.category, row.distanceMiles));
    return rows.slice(0, 3);
  } catch {
    return [];
  }
}

export async function listLocalGuideForProperty(
  propertyId: string,
  client?: SupabaseClient | null,
): Promise<{
  rows: LocalGuideRow[];
  setupRequired: boolean;
}> {
  const id = sanitizeGuideText(propertyId, LOCAL_GUIDE_LIMITS.propertyId);
  if (!id) return { rows: [], setupRequired: false };
  try {
    const { data, error } = await guideClient(client)
      .from("property_local_guide")
      .select("id, property_id, category, business_name, distance_miles, host_note, website_or_maps_link, active, sort_order")
      .eq("property_id", id)
      .order("sort_order", { ascending: true })
      .order("business_name", { ascending: true });
    if (error) {
      if (isMissingLocalGuideTable(error)) return { rows: [], setupRequired: true };
      return { rows: [], setupRequired: false };
    }
    return { rows: ((data ?? []) as DbRow[]).map(toHostRow), setupRequired: false };
  } catch {
    return { rows: [], setupRequired: false };
  }
}

export async function insertLocalGuide(input: LocalGuideWrite, client?: SupabaseClient | null) {
  try {
    const { data, error } = await guideClient(client)
      .from("property_local_guide")
      .insert({
        property_id: input.propertyId,
        category: input.category,
        business_name: input.businessName,
        distance_miles: input.distanceMiles,
        host_note: input.hostNote,
        website_or_maps_link: input.websiteOrMapsLink,
        active: input.active,
        sort_order: input.sortOrder,
      })
      .select("id, property_id, category, business_name, distance_miles, host_note, website_or_maps_link, active, sort_order")
      .single();
    if (error) {
      if (isMissingLocalGuideTable(error)) return { setupRequired: true as const, row: null };
      return { setupRequired: false as const, row: null };
    }
    return { setupRequired: false as const, row: toHostRow(data as DbRow) };
  } catch {
    return { setupRequired: false as const, row: null };
  }
}

export async function updateLocalGuide(
  id: string,
  propertyId: string,
  patch: Partial<{
    category: LocalGuideCategory;
    businessName: string;
    distanceMiles: number | null;
    hostNote: string;
    websiteOrMapsLink: string;
    active: boolean;
    sortOrder: number;
  }>,
  client?: SupabaseClient | null,
) {
  try {
    const existing = await guideClient(client)
      .from("property_local_guide")
      .select("id, property_id")
      .eq("id", id)
      .maybeSingle();
    if (existing.error) {
      if (isMissingLocalGuideTable(existing.error)) return { setupRequired: true as const, row: null, forbidden: false };
      return { setupRequired: false as const, row: null, forbidden: false };
    }
    if (!existing.data || existing.data.property_id !== propertyId) {
      return { setupRequired: false as const, row: null, forbidden: true };
    }
    const next: Record<string, unknown> = {};
    if (patch.category) next.category = patch.category;
    if (patch.businessName !== undefined) next.business_name = patch.businessName;
    if (patch.distanceMiles !== undefined) next.distance_miles = patch.distanceMiles;
    if (patch.hostNote !== undefined) next.host_note = patch.hostNote;
    if (patch.websiteOrMapsLink !== undefined) next.website_or_maps_link = patch.websiteOrMapsLink;
    if (patch.active !== undefined) next.active = patch.active;
    if (patch.sortOrder !== undefined) next.sort_order = patch.sortOrder;
    const { data, error } = await guideClient(client)
      .from("property_local_guide")
      .update(next)
      .eq("id", id)
      .eq("property_id", propertyId)
      .select("id, property_id, category, business_name, distance_miles, host_note, website_or_maps_link, active, sort_order")
      .single();
    if (error) return { setupRequired: false as const, row: null, forbidden: false };
    return { setupRequired: false as const, row: toHostRow(data as DbRow), forbidden: false };
  } catch {
    return { setupRequired: false as const, row: null, forbidden: false };
  }
}

export async function deleteLocalGuide(id: string, propertyId: string, client?: SupabaseClient | null) {
  try {
    const existing = await guideClient(client)
      .from("property_local_guide")
      .select("id, property_id")
      .eq("id", id)
      .maybeSingle();
    if (existing.error) {
      if (isMissingLocalGuideTable(existing.error)) return { setupRequired: true as const, forbidden: false, ok: false };
      return { setupRequired: false as const, forbidden: false, ok: false };
    }
    if (!existing.data || existing.data.property_id !== propertyId) {
      return { setupRequired: false as const, forbidden: true, ok: false };
    }
    const { error } = await guideClient(client).from("property_local_guide").delete().eq("id", id).eq("property_id", propertyId);
    if (error) return { setupRequired: false as const, forbidden: false, ok: false };
    return { setupRequired: false as const, forbidden: false, ok: true };
  } catch {
    return { setupRequired: false as const, forbidden: false, ok: false };
  }
}
