import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  HOUSEKEEPING_STORAGE_BUCKET,
  housekeepingStoragePath,
  parseHousekeepingPhotoCategory,
} from "@/lib/housekeeping-photos";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/jpg"]);

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const propertyId = String(form.get("propertyId") ?? "").trim();
  const reservationId = String(form.get("reservationId") ?? "").trim();
  const category = parseHousekeepingPhotoCategory(String(form.get("category") ?? ""));
  const staffName = String(form.get("staffName") ?? "").trim() || null;
  const files = form
    .getAll("files")
    .concat(form.get("file") ? [form.get("file") as FormDataEntryValue] : [])
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!propertyId || !reservationId || !category) {
    return Response.json({ error: "propertyId, reservationId, and category are required." }, { status: 400 });
  }
  if (!files.length) {
    return Response.json({ error: "Add at least one photo." }, { status: 400 });
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "Supabase service role is not configured." },
      { status: 503 },
    );
  }

  await admin.storage.createBucket(HOUSEKEEPING_STORAGE_BUCKET, { public: true }).catch(() => undefined);

  const capturedAt = new Date().toISOString();
  const uploaded: { id: string; imageUrl: string; storagePath: string; category: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return Response.json({ error: `${file.name} is larger than 12 MB.` }, { status: 413 });
    }
    const type = (file.type || "image/jpeg").toLowerCase();
    if (!ALLOWED_TYPES.has(type) && !type.startsWith("image/")) {
      return Response.json({ error: `${file.name} is not an image.` }, { status: 415 });
    }

    const ext = extensionFor(file.name, type);
    const storagePath = housekeepingStoragePath(propertyId, reservationId, `${Date.now()}-${randomUUID()}.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from(HOUSEKEEPING_STORAGE_BUCKET).upload(storagePath, buffer, {
      contentType: type.startsWith("image/") ? type : "image/jpeg",
      upsert: false,
    });
    if (uploadError) {
      return Response.json({ error: uploadError.message }, { status: 502 });
    }

    const { data: publicUrl } = admin.storage.from(HOUSEKEEPING_STORAGE_BUCKET).getPublicUrl(storagePath);
    const imageUrl = publicUrl.publicUrl;
    const id = randomUUID();

    const { error: insertError } = await admin.from("housekeeping_photos").insert({
      id,
      property_id: propertyId,
      reservation_id: reservationId,
      category,
      storage_path: storagePath,
      image_url: imageUrl,
      captured_at: capturedAt,
      staff_name: staffName,
      content_type: type,
      file_size: file.size,
    });

    if (insertError) {
      return Response.json(
        {
          error: insertError.message,
          hint: "Run supabase/schema.sql so housekeeping_photos and the housekeeping storage bucket exist.",
          storagePath,
          imageUrl,
        },
        { status: 502 },
      );
    }

    uploaded.push({ id, imageUrl, storagePath, category });
  }

  return Response.json({
    ok: true,
    count: uploaded.length,
    photos: uploaded,
    propertyId,
    reservationId,
    category,
    capturedAt,
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
