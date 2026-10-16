import { randomUUID } from "node:crypto";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadHostListings } from "@/lib/host-listings-server";
import { requireHostUser } from "@/lib/supabase-route";
import {
  HOUSEKEEPING_STORAGE_BUCKET,
  housekeepingStoragePath,
  parseHousekeepingReportCategory,
  type HousekeepingReport,
  type HousekeepingReportPhoto,
} from "@/lib/housekeeping-photos";
import { saveHousekeepingReport } from "@/lib/housekeeping-reports-store";
import { notifyHostOfHousekeepingReport } from "@/lib/notify-housekeeping-report";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/jpg"]);

export async function GET(request: Request) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });
  const listings = await loadHostListings(admin, auth.user.id);
  if (listings.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const ownedIds = new Set(listings.properties.map((property) => property.id));
  const propertyId = new URL(request.url).searchParams.get("propertyId")?.trim() || "";
  if (propertyId && !ownedIds.has(propertyId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { listHousekeepingReports } = await import("@/lib/housekeeping-reports-store");
  let reports = listHousekeepingReports(propertyId || undefined).filter((row) => ownedIds.has(row.propertyId));

  if (ownedIds.size) {
    let query = admin
      .from("housekeeping_reports")
      .select("*")
      .in("property_id", [...ownedIds])
      .order("created_at", { ascending: false })
      .limit(80);
    if (propertyId) query = query.eq("property_id", propertyId);
    const { data } = await query;
    if (data?.length) {
      const mapped: HousekeepingReport[] = data.map((row) => ({
        id: String(row.id),
        propertyId: String(row.property_id),
        propertyName: String(row.property_name ?? ""),
        propertyCity: String(row.property_city ?? ""),
        reservationId: String(row.reservation_id ?? "unscheduled"),
        category: row.category,
        notes: String(row.notes ?? ""),
        staffName: row.staff_name ? String(row.staff_name) : null,
        createdAt: String(row.created_at),
        photos: Array.isArray(row.photos) ? (row.photos as HousekeepingReportPhoto[]) : [],
      }));
      const ids = new Set(mapped.map((row) => row.id));
      reports = [...mapped, ...reports.filter((row) => !ids.has(row.id))];
    }
  }

  return Response.json({ reports });
}

export async function POST(request: Request) {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return Response.json({ error: "Service unavailable" }, { status: 503 });
  const listings = await loadHostListings(admin, auth.user.id);
  if (listings.kind === "unavailable") {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const propertyId = String(form.get("propertyId") ?? "").trim();
  const reservationId = String(form.get("reservationId") ?? "").trim() || "unscheduled";
  const category = parseHousekeepingReportCategory(String(form.get("category") ?? ""));
  const notes = String(form.get("notes") ?? "").trim().slice(0, 800);
  const staffName = String(form.get("staffName") ?? "").trim() || null;
  const files = form
    .getAll("files")
    .concat(form.get("file") ? [form.get("file") as FormDataEntryValue] : [])
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!propertyId || !category) {
    return Response.json({ error: "Property and status category are required." }, { status: 400 });
  }
  if (!files.length) {
    return Response.json({ error: "Add at least one photo." }, { status: 400 });
  }

  const property = listings.properties.find((row) => row.id === propertyId);
  if (!property) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (reservationId !== "unscheduled") {
    const reservation = listings.reservations.find((row) => row.id === reservationId);
    if (!reservation || reservation.propertyId !== propertyId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const propertyName = property?.name ?? propertyId;
  const propertyCity = property?.city ?? "";

  const createdAt = new Date().toISOString();
  const reportId = randomUUID();
  const photos: HousekeepingReportPhoto[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return Response.json({ error: `${file.name} is larger than 12 MB.` }, { status: 413 });
    }
    const type = (file.type || "image/jpeg").toLowerCase();
    if (!ALLOWED_TYPES.has(type) && !type.startsWith("image/")) {
      return Response.json({ error: `${file.name} is not an image.` }, { status: 415 });
    }

    const ext = extensionFor(file.name, type);
    const photoId = randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = housekeepingStoragePath(propertyId, reservationId, `${Date.now()}-${photoId}.${ext}`);
    const { error: uploadError } = await admin.storage.from(HOUSEKEEPING_STORAGE_BUCKET).upload(storagePath, buffer, {
      contentType: type.startsWith("image/") ? type : "image/jpeg",
      upsert: false,
    });
    if (uploadError) {
      return Response.json({ error: "Photo storage is unavailable; nothing was recorded locally." }, { status: 503 });
    }
    const imageUrl = admin.storage.from(HOUSEKEEPING_STORAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
    const { error: photoError } = await admin.from("housekeeping_photos").insert({
      id: photoId,
      property_id: propertyId,
      reservation_id: reservationId,
      category,
      storage_path: storagePath,
      image_url: imageUrl,
      captured_at: createdAt,
      staff_name: staffName,
      content_type: type,
      file_size: file.size,
      notes,
      report_id: reportId,
    });
    if (photoError) {
      return Response.json({ error: "Photo metadata could not be recorded." }, { status: 503 });
    }

    photos.push({ id: photoId, imageUrl, storagePath });
  }

  const report: HousekeepingReport = {
    id: reportId,
    propertyId,
    propertyName,
    propertyCity,
    reservationId,
    category,
    notes,
    staffName,
    createdAt,
    photos,
  };

  saveHousekeepingReport(report);

  if (admin) {
    await admin.from("housekeeping_reports").insert({
      id: report.id,
      property_id: report.propertyId,
      property_name: report.propertyName,
      property_city: report.propertyCity,
      reservation_id: report.reservationId,
      category: report.category,
      notes: report.notes,
      staff_name: report.staffName,
      created_at: report.createdAt,
      photos: report.photos,
    });
  }

  const alert = await notifyHostOfHousekeepingReport(report);

  return Response.json({
    ok: true,
    report,
    alert,
    count: photos.length,
  });
}

function extensionFor(name: string, type: string) {
  const fromName = name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && /^[a-z0-9]+$/.test(fromName) && fromName.length <= 5) return fromName;
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("heic") || type.includes("heif")) return "heic";
  return "jpg";
}
