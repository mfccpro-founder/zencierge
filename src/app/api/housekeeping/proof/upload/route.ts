import "server-only";

import { NextRequest } from "next/server";
import { housekeepingProofClientIp, housekeepingProofJson } from "@/lib/housekeeping-proof";
import {
  createSupabaseHousekeepingProofPhotoStore,
  handleHousekeepingProofPhotoUpload,
  housekeepingProofPhotoAdminClient,
} from "@/lib/housekeeping-proof-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await handleHousekeepingProofPhotoUpload({
      contentLength: request.headers.get("content-length"),
      readFormData: () => request.formData(),
      ip: housekeepingProofClientIp(request.headers),
      getStore() {
        const admin = housekeepingProofPhotoAdminClient();
        if (!admin) return null;
        return createSupabaseHousekeepingProofPhotoStore(admin);
      },
    });
    return housekeepingProofJson(result.body, result.status);
  } catch {
    return housekeepingProofJson({ error: "unavailable" }, 503);
  }
}
