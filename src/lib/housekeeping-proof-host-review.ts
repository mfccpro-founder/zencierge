import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOUSEKEEPING_PROOF_PHOTO_BUCKET,
  isHousekeepingProofPhotoPath,
} from "@/lib/housekeeping-proof-photo";
import {
  housekeepingProofAdminClient,
  housekeepingProofCreatedBy,
  housekeepingProofOwnershipStore,
} from "@/lib/housekeeping-proof";
import {
  stayLinksPostOwnershipGate,
  type HostOwnershipAuthSource,
  type HostOwnershipStore,
} from "@/lib/host-property-ownership";

/** Server-only. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("housekeeping-proof-host-review is server-only");
}

export const HOUSEKEEPING_PROOF_HOST_PHOTO_MAX = 8;
export const HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS = 20_000;
export const HOUSEKEEPING_PROOF_HOST_TASK_REVIEW_COLUMNS = "id, property_id, reservation_id, stage, status";
export const HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_COLUMNS = "id, uploaded_at";
export const HOUSEKEEPING_PROOF_HOST_PHOTO_BYTES_COLUMNS = "id, task_id, storage_path";
export const HOUSEKEEPING_PROOF_REVIEW_RPC = "review_housekeeping_proof_batch_atomic";
const REVIEW_BODY_KEYS = ["reservationId", "stage", "decision"] as const;
const REVIEW_SUCCESS_KEYS = ["ok", "status", "reviewedPhotoCount", "idempotent"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEWABLE = new Set(["open", "submitted", "needs_attention"]);
const QUERY_KEYS = ["reservationId", "stage"] as const;
const STATUS_KEYS = ["ok", "photoCount", "latestReceivedAt", "reviewable", "canIssueLink"] as const;
const LIST_KEYS = ["ok", "photos"] as const;
const PHOTO_ITEM_KEYS = ["id", "receivedAt"] as const;

export type HousekeepingProofHostReviewStage = "post_checkout" | "ready_for_checkin";

export type HousekeepingProofHostPhotoStatusBody = {
  ok: true;
  photoCount: number;
  latestReceivedAt: string | null;
  reviewable: boolean;
  canIssueLink: boolean;
};

export type HousekeepingProofHostPhotoListItem = { id: string; receivedAt: string };

export type HousekeepingProofHostTaskRow = {
  id: string;
  property_id: string;
  reservation_id: string;
  stage: string;
  status: string;
};

export type HousekeepingProofHostPhotoRow = {
  id: string;
  uploaded_at: string;
};

export type HousekeepingProofHostPhotoBytesRow = {
  id: string;
  task_id: string;
  storage_path: string;
};

export type HousekeepingProofHostReviewDecision = "approve" | "needs_attention";

export type HousekeepingProofReviewBatchArgs = {
  propertyId: string;
  reservationId: string;
  stage: HousekeepingProofHostReviewStage;
  decision: HousekeepingProofHostReviewDecision;
  reviewedBy: string | null;
};

export type HousekeepingProofReviewBatchResult = {
  status: string;
  reviewed_photo_count: number;
  idempotent: boolean;
};

export type HousekeepingProofHostReviewStore = {
  findTask(reservationId: string, stage: HousekeepingProofHostReviewStage): Promise<HousekeepingProofHostTaskRow | null>;
  listPendingPhotos(taskId: string): Promise<HousekeepingProofHostPhotoRow[]>;
  getPhoto(photoId: string): Promise<HousekeepingProofHostPhotoBytesRow | null>;
  getTaskById(taskId: string): Promise<HousekeepingProofHostTaskRow | null>;
  downloadJpeg(storagePath: string): Promise<Buffer | null>;
  reviewBatchAtomic(args: HousekeepingProofReviewBatchArgs): Promise<HousekeepingProofReviewBatchResult>;
};

export class HousekeepingProofReviewRpcError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("unavailable");
    this.name = "HousekeepingProofReviewRpcError";
    this.code = code;
  }
}

function isStage(value: string): value is HousekeepingProofHostReviewStage {
  return value === "post_checkout" || value === "ready_for_checkin";
}

export function isHousekeepingProofHostPhotoId(value: string) {
  return UUID_RE.test(value);
}

export function isHousekeepingProofHostReviewableStatus(status: string) {
  return REVIEWABLE.has(status);
}

function unauthorized() {
  return { status: 401, body: { error: "Unauthorized" } as Record<string, unknown> };
}

function forbidden() {
  return { status: 403, body: { error: "unavailable" } as Record<string, unknown> };
}

function invalid404() {
  return { status: 404, body: { error: "invalid" } as Record<string, unknown> };
}

function unavailable() {
  return { status: 503, body: { error: "unavailable" } as Record<string, unknown> };
}

function emptyStatus(): HousekeepingProofHostPhotoStatusBody {
  return { ok: true, photoCount: 0, latestReceivedAt: null, reviewable: false, canIssueLink: true };
}

export function parseHousekeepingProofHostPhotoQuery(search: URLSearchParams):
  | { reservationId: string; stage: HousekeepingProofHostReviewStage }
  | { error: "invalid" } {
  const keys = [...search.keys()].sort();
  if (keys.length !== QUERY_KEYS.length || keys.join(",") !== [...QUERY_KEYS].sort().join(",")) {
    return { error: "invalid" };
  }
  const reservationId = search.get("reservationId")?.trim() ?? "";
  const stage = search.get("stage")?.trim() ?? "";
  if (!reservationId || !isStage(stage)) return { error: "invalid" };
  return { reservationId, stage };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDecision(value: unknown): value is HousekeepingProofHostReviewDecision {
  return value === "approve" || value === "needs_attention";
}

export function parseHousekeepingProofHostReviewBody(
  body: unknown,
):
  | { reservationId: string; stage: HousekeepingProofHostReviewStage; decision: HousekeepingProofHostReviewDecision }
  | { error: "invalid" } {
  if (!isPlainObject(body)) return { error: "invalid" };
  const keys = Object.keys(body);
  if (keys.length !== REVIEW_BODY_KEYS.length) return { error: "invalid" };
  if (!REVIEW_BODY_KEYS.every((key) => keys.includes(key))) return { error: "invalid" };
  const reservationId = typeof body.reservationId === "string" ? body.reservationId.trim() : "";
  if (!reservationId || reservationId.length > 80) return { error: "invalid" };
  const stage = typeof body.stage === "string" ? body.stage.trim() : "";
  if (!isStage(stage)) return { error: "invalid" };
  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!isDecision(decision)) return { error: "invalid" };
  return { reservationId, stage, decision };
}

export function mapHousekeepingProofReviewRpcCode(code: string | undefined): { status: number; body: Record<string, unknown> } {
  if (code === "ZP002") return invalid404();
  if (code === "ZP003") return { status: 409, body: { error: "unavailable" } };
  return unavailable();
}

function parseHousekeepingProofReviewRpcResult(data: unknown): HousekeepingProofReviewBatchResult | null {
  let row: unknown = data;
  if (Array.isArray(data)) {
    if (data.length !== 1) return null;
    row = data[0];
  }
  if (!isPlainObject(row)) return null;
  const status = typeof row.status === "string" ? row.status : "";
  if (status !== "approved" && status !== "needs_attention") return null;
  const count = row.reviewed_photo_count;
  const reviewed_photo_count =
    typeof count === "number" && Number.isInteger(count) && count >= 0
      ? count
      : typeof count === "string" && /^\d+$/.test(count)
        ? Number(count)
        : NaN;
  if (!Number.isInteger(reviewed_photo_count) || reviewed_photo_count < 0) return null;
  if (typeof row.idempotent !== "boolean") return null;
  return { status, reviewed_photo_count, idempotent: row.idempotent };
}

export async function reviewHousekeepingProofHostBatch(input: {
  userId: string | null | undefined;
  hostAuthSource: HostOwnershipAuthSource | null;
  body: unknown;
  ownershipStore: HostOwnershipStore;
  store: HousekeepingProofHostReviewStore;
  nodeEnv?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.userId) return unauthorized();
  if (input.hostAuthSource !== "supabase-auth" && input.hostAuthSource !== "dev-fallback") {
    return unauthorized();
  }

  const parsed = parseHousekeepingProofHostReviewBody(input.body);
  if ("error" in parsed) return { status: 400, body: { error: "invalid" } };

  const gate = await ownedReservationProperty({
    reservationId: parsed.reservationId,
    userId: input.userId,
    hostAuthSource: input.hostAuthSource,
    ownershipStore: input.ownershipStore,
    nodeEnv: input.nodeEnv,
  });
  if (gate.kind === "unauthorized") return unauthorized();
  if (gate.kind === "unowned") return forbidden();
  if (gate.kind === "unavailable") return unavailable();

  const reviewedBy = housekeepingProofCreatedBy(input.userId, input.hostAuthSource);
  try {
    const result = await input.store.reviewBatchAtomic({
      propertyId: gate.propertyId,
      reservationId: parsed.reservationId,
      stage: parsed.stage,
      decision: parsed.decision,
      reviewedBy,
    });
    if (
      typeof result.status !== "string" ||
      !Number.isInteger(result.reviewed_photo_count) ||
      result.reviewed_photo_count < 0 ||
      typeof result.idempotent !== "boolean"
    ) {
      return unavailable();
    }
    return {
      status: 200,
      body: {
        ok: true,
        status: result.status,
        reviewedPhotoCount: result.reviewed_photo_count,
        idempotent: result.idempotent,
      },
    };
  } catch (error) {
    const code = error instanceof HousekeepingProofReviewRpcError ? error.code : undefined;
    return mapHousekeepingProofReviewRpcCode(code);
  }
}

function sortPhotosNewestFirst(rows: HousekeepingProofHostPhotoRow[]) {
  return [...rows].sort((a, b) => {
    const time = b.uploaded_at.localeCompare(a.uploaded_at);
    if (time !== 0) return time;
    return b.id.localeCompare(a.id);
  });
}

function boundPhotos(rows: HousekeepingProofHostPhotoRow[]) {
  return sortPhotosNewestFirst(rows).slice(0, HOUSEKEEPING_PROOF_HOST_PHOTO_MAX);
}

function toIso(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

async function ownedReservationProperty(input: {
  reservationId: string;
  userId: string | null | undefined;
  hostAuthSource: HostOwnershipAuthSource | null;
  ownershipStore: HostOwnershipStore;
  nodeEnv?: string;
}): Promise<{ kind: "owned"; propertyId: string } | { kind: "unowned" } | { kind: "unavailable" } | { kind: "unauthorized" }> {
  if (!input.userId) return { kind: "unauthorized" };
  if (input.hostAuthSource !== "supabase-auth" && input.hostAuthSource !== "dev-fallback") {
    return { kind: "unauthorized" };
  }
  try {
    return await stayLinksPostOwnershipGate({
      reservationId: input.reservationId,
      auth: { userId: input.userId, source: input.hostAuthSource },
      store: input.ownershipStore,
      nodeEnv: input.nodeEnv,
    });
  } catch {
    return { kind: "unavailable" };
  }
}

function taskMatchesOwned(
  task: HousekeepingProofHostTaskRow,
  reservationId: string,
  stage: HousekeepingProofHostReviewStage,
  propertyId: string,
) {
  return (
    task.reservation_id === reservationId &&
    task.stage === stage &&
    task.property_id === propertyId
  );
}

export async function listHousekeepingProofHostPhotoStatus(input: {
  userId: string | null | undefined;
  hostAuthSource: HostOwnershipAuthSource | null;
  search: URLSearchParams;
  ownershipStore: HostOwnershipStore;
  store: HousekeepingProofHostReviewStore;
  nodeEnv?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseHousekeepingProofHostPhotoQuery(input.search);
  if ("error" in parsed) return { status: 400, body: { error: "invalid" } };

  const gate = await ownedReservationProperty({
    reservationId: parsed.reservationId,
    userId: input.userId,
    hostAuthSource: input.hostAuthSource,
    ownershipStore: input.ownershipStore,
    nodeEnv: input.nodeEnv,
  });
  if (gate.kind === "unauthorized") return unauthorized();
  if (gate.kind === "unowned") return forbidden();
  if (gate.kind === "unavailable") return unavailable();

  let task: HousekeepingProofHostTaskRow | null;
  try {
    task = await input.store.findTask(parsed.reservationId, parsed.stage);
  } catch {
    return unavailable();
  }
  if (!task) return { status: 200, body: emptyStatus() };
  if (!taskMatchesOwned(task, parsed.reservationId, parsed.stage, gate.propertyId)) return forbidden();
  if (!isHousekeepingProofHostReviewableStatus(task.status)) {
    return { status: 200, body: { ...emptyStatus(), canIssueLink: false } };
  }

  let photos: HousekeepingProofHostPhotoRow[];
  try {
    photos = boundPhotos(await input.store.listPendingPhotos(task.id));
  } catch {
    return unavailable();
  }
  const latest = photos[0] ? toIso(photos[0].uploaded_at) : null;
  const body: HousekeepingProofHostPhotoStatusBody = {
    ok: true,
    photoCount: photos.length,
    latestReceivedAt: latest,
    reviewable: task.status === "submitted" && photos.length > 0,
    // Submitted keeps evidence; only open / needs_attention may mint or rotate a cleaner link.
    canIssueLink: task.status === "open" || task.status === "needs_attention",
  };
  return { status: 200, body };
}

export async function listHousekeepingProofHostPhotos(input: {
  userId: string | null | undefined;
  hostAuthSource: HostOwnershipAuthSource | null;
  search: URLSearchParams;
  ownershipStore: HostOwnershipStore;
  store: HousekeepingProofHostReviewStore;
  nodeEnv?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseHousekeepingProofHostPhotoQuery(input.search);
  if ("error" in parsed) return { status: 400, body: { error: "invalid" } };

  const gate = await ownedReservationProperty({
    reservationId: parsed.reservationId,
    userId: input.userId,
    hostAuthSource: input.hostAuthSource,
    ownershipStore: input.ownershipStore,
    nodeEnv: input.nodeEnv,
  });
  if (gate.kind === "unauthorized") return unauthorized();
  if (gate.kind === "unowned") return forbidden();
  if (gate.kind === "unavailable") return unavailable();

  let task: HousekeepingProofHostTaskRow | null;
  try {
    task = await input.store.findTask(parsed.reservationId, parsed.stage);
  } catch {
    return unavailable();
  }
  if (!task) return { status: 200, body: { ok: true, photos: [] } };
  if (!taskMatchesOwned(task, parsed.reservationId, parsed.stage, gate.propertyId)) return forbidden();
  if (!isHousekeepingProofHostReviewableStatus(task.status)) {
    return { status: 200, body: { ok: true, photos: [] } };
  }

  let photos: HousekeepingProofHostPhotoRow[];
  try {
    photos = boundPhotos(await input.store.listPendingPhotos(task.id));
  } catch {
    return unavailable();
  }
  const items: HousekeepingProofHostPhotoListItem[] = [];
  for (const row of photos) {
    const receivedAt = toIso(row.uploaded_at);
    if (!isHousekeepingProofHostPhotoId(row.id) || !receivedAt) continue;
    items.push({ id: row.id, receivedAt });
  }
  return { status: 200, body: { ok: true, photos: items } };
}

export async function loadHousekeepingProofHostPhotoBytes(input: {
  userId: string | null | undefined;
  hostAuthSource: HostOwnershipAuthSource | null;
  photoId: string;
  ownershipStore: HostOwnershipStore;
  store: HousekeepingProofHostReviewStore;
  nodeEnv?: string;
}): Promise<{ status: number; body?: Record<string, unknown>; bytes?: Buffer }> {
  if (!isHousekeepingProofHostPhotoId(input.photoId)) return invalid404();

  let photo: HousekeepingProofHostPhotoBytesRow | null;
  try {
    photo = await input.store.getPhoto(input.photoId);
  } catch {
    return unavailable();
  }
  if (!photo || photo.id !== input.photoId) return invalid404();
  if (!isHousekeepingProofPhotoPath(photo.storage_path)) return invalid404();

  let task: HousekeepingProofHostTaskRow | null;
  try {
    task = await input.store.getTaskById(photo.task_id);
  } catch {
    return unavailable();
  }
  if (!task || task.id !== photo.task_id) return invalid404();
  if (!isStage(task.stage) || !isHousekeepingProofHostReviewableStatus(task.status)) return invalid404();

  const gate = await ownedReservationProperty({
    reservationId: task.reservation_id,
    userId: input.userId,
    hostAuthSource: input.hostAuthSource,
    ownershipStore: input.ownershipStore,
    nodeEnv: input.nodeEnv,
  });
  if (gate.kind === "unauthorized") return unauthorized();
  if (gate.kind === "unowned" || gate.kind === "unavailable") return invalid404();
  if (task.property_id !== gate.propertyId) return invalid404();

  let bytes: Buffer | null;
  try {
    bytes = await input.store.downloadJpeg(photo.storage_path);
  } catch {
    return unavailable();
  }
  if (!bytes || bytes.length === 0) return unavailable();
  return { status: 200, bytes };
}

export function housekeepingProofHostPhotoBytesResponse(bytes: Buffer) {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type MemoryHousekeepingProofHostTask = HousekeepingProofHostTaskRow & {
  reviewed_at?: string | null;
};

type MemoryHousekeepingProofHostPhoto = HousekeepingProofHostPhotoRow & {
  task_id: string;
  storage_path?: string;
  review_status?: "pending" | "approved" | "rejected";
  reviewed_at?: string | null;
  reviewed_by?: string | null;
};

export type MemoryHousekeepingProofHostReviewRows = {
  tasks?: MemoryHousekeepingProofHostTask[];
  photos?: MemoryHousekeepingProofHostPhoto[];
  files?: Record<string, Buffer>;
  failFind?: boolean;
  failList?: boolean;
  failGet?: boolean;
  failDownload?: boolean;
  failReviewCode?: string;
};

export function createMemoryHousekeepingProofHostReviewStore(rows: MemoryHousekeepingProofHostReviewRows = {}) {
  const tasks: MemoryHousekeepingProofHostTask[] = (rows.tasks ?? []).map((row) => ({ ...row }));
  const photos: MemoryHousekeepingProofHostPhoto[] = (rows.photos ?? []).map((row) => ({ ...row }));
  const files = { ...(rows.files ?? {}) };
  const store: HousekeepingProofHostReviewStore = {
    async findTask(reservationId, stage) {
      if (rows.failFind) throw new Error("unavailable");
      return tasks.find((row) => row.reservation_id === reservationId && row.stage === stage) ?? null;
    },
    async listPendingPhotos(taskId) {
      if (rows.failList) throw new Error("unavailable");
      return photos.filter((row) => row.task_id === taskId);
    },
    async getPhoto(photoId) {
      if (rows.failGet) throw new Error("unavailable");
      const row = photos.find((item) => item.id === photoId);
      if (!row) return null;
      return { id: row.id, task_id: row.task_id, storage_path: row.storage_path ?? `proof/${row.id}.jpg` };
    },
    async getTaskById(taskId) {
      if (rows.failGet) throw new Error("unavailable");
      return tasks.find((row) => row.id === taskId) ?? null;
    },
    async downloadJpeg(storagePath) {
      if (rows.failDownload) throw new Error("unavailable");
      return files[storagePath] ?? null;
    },
    async reviewBatchAtomic(args) {
      if (rows.failReviewCode) throw new HousekeepingProofReviewRpcError(rows.failReviewCode);
      const task = tasks.find((row) => row.reservation_id === args.reservationId && row.stage === args.stage);
      if (!task) throw new HousekeepingProofReviewRpcError("ZP002");
      if (task.property_id !== args.propertyId) throw new HousekeepingProofReviewRpcError("ZP002");

      const pending = photos.filter((row) => row.task_id === task.id && (row.review_status ?? "pending") === "pending");

      if (task.status === "approved" && args.decision === "approve" && pending.length === 0) {
        return { status: "approved", reviewed_photo_count: 0, idempotent: true };
      }
      if (task.status === "needs_attention" && args.decision === "needs_attention" && pending.length === 0) {
        return { status: "needs_attention", reviewed_photo_count: 0, idempotent: true };
      }
      if (task.status === "closed") throw new HousekeepingProofReviewRpcError("ZP003");
      if (task.status === "approved") throw new HousekeepingProofReviewRpcError("ZP003");
      if (task.status !== "submitted") {
        throw new HousekeepingProofReviewRpcError("ZP003");
      }
      if (pending.length < 1) throw new HousekeepingProofReviewRpcError("ZP003");

      const now = new Date().toISOString();
      const photoStatus = args.decision === "approve" ? "approved" : "rejected";
      const taskStatus = args.decision === "approve" ? "approved" : "needs_attention";
      for (const photo of pending) {
        photo.review_status = photoStatus;
        photo.reviewed_at = now;
        photo.reviewed_by = args.reviewedBy;
      }
      task.status = taskStatus;
      task.reviewed_at = now;
      return { status: taskStatus, reviewed_photo_count: pending.length, idempotent: false };
    },
  };
  return store;
}

export function createSupabaseHousekeepingProofHostReviewStore(admin: SupabaseClient): HousekeepingProofHostReviewStore {
  return {
    async findTask(reservationId, stage) {
      const { data, error } = await admin
        .from("housekeeping_proof_tasks")
        .select(HOUSEKEEPING_PROOF_HOST_TASK_REVIEW_COLUMNS)
        .eq("reservation_id", reservationId)
        .eq("stage", stage)
        .maybeSingle();
      if (error) throw new Error("unavailable");
      if (!data) return null;
      return mapTask(data as Record<string, unknown>);
    },
    async listPendingPhotos(taskId) {
      const { data, error } = await admin
        .from("housekeeping_proof_photos")
        .select(HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_COLUMNS)
        .eq("task_id", taskId)
        .eq("review_status", "pending")
        .order("uploaded_at", { ascending: false })
        .limit(HOUSEKEEPING_PROOF_HOST_PHOTO_MAX);
      if (error) throw new Error("unavailable");
      return (data ?? [])
        .map((row) => mapPhoto(row as Record<string, unknown>))
        .filter((row): row is HousekeepingProofHostPhotoRow => row !== null);
    },
    async getPhoto(photoId) {
      const { data, error } = await admin
        .from("housekeeping_proof_photos")
        .select(HOUSEKEEPING_PROOF_HOST_PHOTO_BYTES_COLUMNS)
        .eq("id", photoId)
        .maybeSingle();
      if (error) throw new Error("unavailable");
      if (!data) return null;
      const row = data as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const taskId = typeof row.task_id === "string" ? row.task_id : "";
      const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
      if (!id || !taskId || !storagePath) return null;
      return { id, task_id: taskId, storage_path: storagePath };
    },
    async getTaskById(taskId) {
      const { data, error } = await admin
        .from("housekeeping_proof_tasks")
        .select(HOUSEKEEPING_PROOF_HOST_TASK_REVIEW_COLUMNS)
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw new Error("unavailable");
      if (!data) return null;
      return mapTask(data as Record<string, unknown>);
    },
    async downloadJpeg(storagePath) {
      const { data, error } = await admin.storage.from(HOUSEKEEPING_PROOF_PHOTO_BUCKET).download(storagePath);
      if (error || !data) return null;
      const bytes = Buffer.from(await data.arrayBuffer());
      return bytes.length ? bytes : null;
    },
    async reviewBatchAtomic(args) {
      const { data, error } = await admin.rpc(HOUSEKEEPING_PROOF_REVIEW_RPC, {
        p_property_id: args.propertyId,
        p_reservation_id: args.reservationId,
        p_stage: args.stage,
        p_decision: args.decision,
        p_reviewed_by: args.reviewedBy,
      });
      if (error) {
        const code = typeof error.code === "string" && error.code ? error.code : "unknown";
        throw new HousekeepingProofReviewRpcError(code);
      }
      const parsed = parseHousekeepingProofReviewRpcResult(data);
      if (!parsed) throw new HousekeepingProofReviewRpcError("unknown");
      return parsed;
    },
  };
}

function mapTask(row: Record<string, unknown>): HousekeepingProofHostTaskRow | null {
  const id = typeof row.id === "string" ? row.id : "";
  const propertyId = typeof row.property_id === "string" ? row.property_id : "";
  const reservationId = typeof row.reservation_id === "string" ? row.reservation_id : "";
  const stage = typeof row.stage === "string" ? row.stage : "";
  const status = typeof row.status === "string" ? row.status : "";
  if (!id || !propertyId || !reservationId || !stage || !status) return null;
  return { id, property_id: propertyId, reservation_id: reservationId, stage, status };
}

function mapPhoto(row: Record<string, unknown>): HousekeepingProofHostPhotoRow | null {
  const id = typeof row.id === "string" ? row.id : "";
  const uploadedAt = typeof row.uploaded_at === "string" ? row.uploaded_at : "";
  if (!id || !uploadedAt) return null;
  return { id, uploaded_at: uploadedAt };
}

export function housekeepingProofHostReviewAdminClient() {
  return housekeepingProofAdminClient();
}

export function housekeepingProofHostReviewOwnershipStore(admin: SupabaseClient) {
  return housekeepingProofOwnershipStore(admin);
}

export function housekeepingProofHostPhotoStatusKeys() {
  return STATUS_KEYS;
}

export function housekeepingProofHostPhotoListKeys() {
  return LIST_KEYS;
}

export function housekeepingProofHostPhotoItemKeys() {
  return PHOTO_ITEM_KEYS;
}

export function housekeepingProofHostReviewSuccessKeys() {
  return REVIEW_SUCCESS_KEYS;
}
