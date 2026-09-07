import { isHttpsOrigin, isLoopbackHostname } from "@/lib/public-app-url";

export const HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH = "/api/housekeeping/proof-options";
export const HOUSEKEEPING_PROOF_HOST_ISSUE_PATH = "/api/housekeeping/proof-links";
export const HOUSEKEEPING_PROOF_HOST_PHOTO_STATUS_PATH = "/api/housekeeping/proof-photos/status";
export const HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_PATH = "/api/housekeeping/proof-photos";
export const HOUSEKEEPING_PROOF_HOST_PHOTO_REVIEW_PATH = "/api/housekeeping/proof-photos/review";
export const HOUSEKEEPING_PROOF_HOST_PHOTO_BYTES_PREFIX = "/api/housekeeping/proof-photos/";
export const HOUSEKEEPING_PROOF_HOST_PATH_PREFIX = "/housekeeping/p/";
export const HOUSEKEEPING_PROOF_HOST_TOKEN_LENGTH = 43;
export const HOUSEKEEPING_PROOF_HOST_PHOTO_MAX = 8;
export const HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS = 20_000;
/** Faster status poll while awaiting the first cleaner photo (cross-device discovery). */
export const HOUSEKEEPING_PROOF_HOST_PHOTO_AWAIT_POLL_MS = 5_000;
export const HOUSEKEEPING_PROOF_HOST_STAGES = ["post_checkout", "ready_for_checkin"] as const;
export const HOUSEKEEPING_PROOF_HOST_REVIEW_DECISIONS = ["approve", "needs_attention"] as const;

export type HousekeepingProofHostStage = (typeof HOUSEKEEPING_PROOF_HOST_STAGES)[number];
export type HousekeepingProofHostReviewDecision = (typeof HOUSEKEEPING_PROOF_HOST_REVIEW_DECISIONS)[number];

export type HousekeepingProofHostProperty = { id: string; name: string };
export type HousekeepingProofHostReservation = {
  id: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  status: string;
  eligibleStages: HousekeepingProofHostStage[];
};

export const HOUSEKEEPING_PROOF_HOST_COPY = {
  title: { en: "Secure cleaner link", es: "Enlace seguro para limpieza" },
  help: {
    en: "Creates a private photo-upload link for this stay. Photos stay visible only to you.",
    es: "Crea un enlace privado para fotos de esta estadía. Solo tú puedes verlas.",
  },
  generate: { en: "Generate secure cleaner link", es: "Crear enlace seguro para limpieza" },
  generating: { en: "Generating…", es: "Creando…" },
  send: { en: "Send to cleaner", es: "Enviar a limpieza" },
  sharing: { en: "Sharing…", es: "Compartiendo…" },
  copy: { en: "Copy link", es: "Copiar enlace" },
  copied: {
    en: "Link copied. Paste it into WhatsApp, Messages, or email.",
    es: "Enlace copiado. Pégalo en WhatsApp, Mensajes o el correo.",
  },
  replace: {
    en: "Generating a new link replaces the previous cleaner link for this stay and stage. Continue?",
    es: "Crear un enlace nuevo reemplaza el enlace anterior de limpieza para esta estadía y etapa. ¿Continuar?",
  },
  unauthorized: { en: "Host sign-in is required.", es: "Debes iniciar sesión como anfitrión." },
  forbidden: { en: "You cannot create a link for this stay.", es: "No puedes crear un enlace para esta estadía." },
  empty: { en: "No eligible stays right now.", es: "No hay estadías elegibles ahora." },
  unavailable: { en: "Link creation is temporarily unavailable.", es: "No se puede crear el enlace temporalmente." },
  stage: {
    post_checkout: { en: "Post-checkout inspection", es: "Inspección después de la salida" },
    ready_for_checkin: { en: "Ready for check-in", es: "Preparación para la llegada" },
  },
  shareTitle: "Housekeeping proof link / Enlace de prueba de limpieza",
  shareText: "Housekeeping proof link / Enlace de prueba de limpieza",
  photosReceived: { en: "Photos received", es: "Fotos recibidas" },
  photosCount: { en: "Photos", es: "Fotos" },
  latestReceived: { en: "Latest received", es: "Última recibida" },
  review: { en: "Review secure photos", es: "Revisar fotos seguras" },
  reviewing: { en: "Loading photos…", es: "Cargando fotos…" },
  uploadedPhotos: { en: "Uploaded photos", es: "Fotos cargadas" },
  reviewDecision: { en: "Review decision", es: "Decisión de revisión" },
  closeGallery: { en: "Close photos", es: "Cerrar fotos" },
  reviewUnavailable: {
    en: "Secure photos are temporarily unavailable.",
    es: "Las fotos seguras no están disponibles temporalmente.",
  },
  photoAlt: { en: "Housekeeping proof photo", es: "Foto de prueba de limpieza" },
  approve: { en: "Approve photos", es: "Aprobar fotos" },
  needsAttention: { en: "Needs attention", es: "Necesita atención" },
  approving: { en: "Approving…", es: "Aprobando…" },
  savingReview: { en: "Saving…", es: "Guardando…" },
  approveConfirm: {
    en: "This will approve all currently pending photos for this stay and stage. This cannot be undone for this batch. Continue?",
    es: "Esto aprobará todas las fotos pendientes de esta estadía y etapa. Esta decisión no se puede deshacer para este lote. ¿Continuar?",
  },
  reviewApproved: { en: "Photos approved.", es: "Fotos aprobadas." },
  reviewNeedsAttention: {
    en: "Attention requested. The cleaner can submit new photos.",
    es: "Atención solicitada. El personal de limpieza puede enviar fotos nuevas.",
  },
  awaitingFinish: {
    en: "Waiting for the cleaner to press Finish and send before you can approve or request attention.",
    es: "Esperando a que el personal de limpieza pulse Terminar y enviar antes de aprobar o solicitar atención.",
  },
  submissionReceived: {
    en: "Cleaner submission received. Review the photos, then Approve or Needs attention. A new cleaner link cannot be created until this review is done.",
    es: "Envío de limpieza recibido. Revisa las fotos y luego Aprueba o Necesita atención. No se puede crear un enlace nuevo hasta terminar esta revisión.",
  },
  generateCancelled: {
    en: "Link generation cancelled. The previous link was kept.",
    es: "Creación de enlace cancelada. Se conservó el enlace anterior.",
  },
  generateSubmittedBlocked: {
    en: "A cleaner submission is waiting for your review. Approve or Needs attention before creating another link.",
    es: "Hay un envío de limpieza esperando tu revisión. Aprueba o marca Necesita atención antes de crear otro enlace.",
  },
  reviewForbidden: { en: "You cannot review this stay.", es: "No puedes revisar esta estadía." },
  reviewSaveFailed: {
    en: "We couldn’t save this review. Please try again.",
    es: "No pudimos guardar esta revisión. Inténtalo de nuevo.",
  },
} as const;

const PROPERTY_KEYS = ["id", "name"] as const;
const RESERVATION_KEYS = ["id", "propertyId", "checkIn", "checkOut", "status", "eligibleStages"] as const;
const ISSUE_KEYS = ["ok", "path", "expiresAt"] as const;
const PHOTO_STATUS_KEYS = ["ok", "photoCount", "latestReceivedAt", "reviewable", "canIssueLink"] as const;
const PHOTO_LIST_KEYS = ["ok", "photos"] as const;
const REVIEW_SUCCESS_KEYS = ["ok", "status", "reviewedPhotoCount", "idempotent"] as const;
const PHOTO_ITEM_KEYS = ["id", "receivedAt"] as const;
const PHOTO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_OPTION_KEYS = [
  "guest",
  "guestName",
  "guest_name",
  "email",
  "phone",
  "address",
  "city",
  "accessCode",
  "access_code",
  "wifi",
  "lockbox",
  "handbook",
  "token",
  "token_hash",
  "taskId",
  "task_id",
  "photo",
  "created_by",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysAreAllowlisted(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasForbiddenOptionKey(value: Record<string, unknown>) {
  return Object.keys(value).some((key) => FORBIDDEN_OPTION_KEYS.includes(key));
}

function isStage(value: unknown): value is HousekeepingProofHostStage {
  return value === "post_checkout" || value === "ready_for_checkin";
}

export function housekeepingProofHostIssueBody(reservationId: string, stage: HousekeepingProofHostStage) {
  return { reservationId, stage };
}

export function housekeepingProofHostReviewBody(
  reservationId: string,
  stage: HousekeepingProofHostStage,
  decision: HousekeepingProofHostReviewDecision,
) {
  return { reservationId, stage, decision };
}

export function isValidHousekeepingProofRelativePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path !== path.trim()) return false;
  if (/^[a-z]+:/i.test(path) || path.startsWith("//") || path.includes("\\")) return false;
  if (path.includes("?") || path.includes("#")) return false;
  if (!path.startsWith(HOUSEKEEPING_PROOF_HOST_PATH_PREFIX)) return false;
  const rest = path.slice(HOUSEKEEPING_PROOF_HOST_PATH_PREFIX.length);
  if (!rest || rest.includes("/")) return false;
  if (rest.length !== HOUSEKEEPING_PROOF_HOST_TOKEN_LENGTH) return false;
  return TOKEN_RE.test(rest);
}

export function isAcceptableHousekeepingProofOrigin(origin: string) {
  const trimmed = origin.trim().replace(/\/$/, "");
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.pathname !== "/" && url.pathname !== "") return false;
    if (url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function chooseHousekeepingProofShareOrigin(pageOrigin: string, reachableOrigin: string) {
  const reachable = reachableOrigin.trim().replace(/\/$/, "");
  const page = pageOrigin.trim().replace(/\/$/, "");
  if (isHttpsOrigin(reachable) && isAcceptableHousekeepingProofOrigin(reachable)) return reachable;
  if (isHttpsOrigin(page) && isAcceptableHousekeepingProofOrigin(page)) return page;
  if (isAcceptableHousekeepingProofOrigin(reachable)) return reachable;
  if (isAcceptableHousekeepingProofOrigin(page)) return page;
  return "";
}

/** Status poll interval: 5s while awaiting photos, 20s after at least one is known. */
export function housekeepingProofHostPhotoPollIntervalMs(photoCount: number) {
  if (!Number.isFinite(photoCount) || photoCount <= 0) {
    return HOUSEKEEPING_PROOF_HOST_PHOTO_AWAIT_POLL_MS;
  }
  return HOUSEKEEPING_PROOF_HOST_PHOTO_POLL_MS;
}

export function buildHousekeepingProofAbsoluteUrl(origin: string, path: string) {
  if (!isValidHousekeepingProofRelativePath(path)) return "";
  if (!isAcceptableHousekeepingProofOrigin(origin)) return "";
  return `${origin.replace(/\/$/, "")}${path}`;
}

export function parseHousekeepingProofOptionsPayload(payload: unknown): {
  properties: HousekeepingProofHostProperty[];
  reservations: HousekeepingProofHostReservation[];
} | null {
  if (!isPlainObject(payload) || payload.ok !== true) return null;
  if (hasForbiddenOptionKey(payload)) return null;
  if (!Array.isArray(payload.properties) || !Array.isArray(payload.reservations)) return null;
  const properties: HousekeepingProofHostProperty[] = [];
  for (const item of payload.properties) {
    if (!isPlainObject(item) || hasForbiddenOptionKey(item) || !keysAreAllowlisted(item, PROPERTY_KEYS)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!id || !name) continue;
    properties.push({ id, name });
  }
  const reservations: HousekeepingProofHostReservation[] = [];
  for (const item of payload.reservations) {
    if (!isPlainObject(item) || hasForbiddenOptionKey(item) || !keysAreAllowlisted(item, RESERVATION_KEYS)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const propertyId = typeof item.propertyId === "string" ? item.propertyId.trim() : "";
    const checkIn = typeof item.checkIn === "string" ? item.checkIn.trim() : "";
    const checkOut = typeof item.checkOut === "string" ? item.checkOut.trim() : "";
    const status = typeof item.status === "string" ? item.status.trim() : "";
    if (!id || !propertyId || !checkIn || !checkOut || !status) continue;
    if (!Array.isArray(item.eligibleStages)) continue;
    const rawStages = item.eligibleStages;
    const eligibleStages = HOUSEKEEPING_PROOF_HOST_STAGES.filter((stage) => rawStages.includes(stage));
    if (!eligibleStages.length) continue;
    reservations.push({ id, propertyId, checkIn, checkOut, status, eligibleStages });
  }
  return { properties, reservations };
}

export function housekeepingProofHostPhotoQuery(reservationId: string, stage: HousekeepingProofHostStage) {
  return `reservationId=${encodeURIComponent(reservationId)}&stage=${encodeURIComponent(stage)}`;
}

export function housekeepingProofHostPhotoBytesPath(photoId: string) {
  if (!PHOTO_ID_RE.test(photoId)) return "";
  return `${HOUSEKEEPING_PROOF_HOST_PHOTO_BYTES_PREFIX}${photoId}`;
}

export function formatHousekeepingProofReceivedAt(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function parseHousekeepingProofPhotoStatusPayload(payload: unknown): {
  photoCount: number;
  latestReceivedAt: string | null;
  reviewable: boolean;
  canIssueLink: boolean;
} | null {
  if (!isPlainObject(payload) || payload.ok !== true) return null;
  if (hasForbiddenOptionKey(payload) || !keysAreAllowlisted(payload, PHOTO_STATUS_KEYS)) return null;
  if (typeof payload.photoCount !== "number" || !Number.isInteger(payload.photoCount)) return null;
  if (payload.photoCount < 0 || payload.photoCount > HOUSEKEEPING_PROOF_HOST_PHOTO_MAX) return null;
  if (payload.latestReceivedAt !== null && typeof payload.latestReceivedAt !== "string") return null;
  if (payload.latestReceivedAt && Number.isNaN(Date.parse(payload.latestReceivedAt))) return null;
  if (typeof payload.reviewable !== "boolean") return null;
  if (typeof payload.canIssueLink !== "boolean") return null;
  return {
    photoCount: payload.photoCount,
    latestReceivedAt: payload.latestReceivedAt,
    reviewable: payload.reviewable,
    canIssueLink: payload.canIssueLink,
  };
}

export function parseHousekeepingProofPhotoListPayload(payload: unknown): { id: string; receivedAt: string }[] | null {
  if (!isPlainObject(payload) || payload.ok !== true) return null;
  if (hasForbiddenOptionKey(payload) || !keysAreAllowlisted(payload, PHOTO_LIST_KEYS)) return null;
  if (!Array.isArray(payload.photos) || payload.photos.length > HOUSEKEEPING_PROOF_HOST_PHOTO_MAX) return null;
  const photos: { id: string; receivedAt: string }[] = [];
  for (const item of payload.photos) {
    if (!isPlainObject(item) || hasForbiddenOptionKey(item) || !keysAreAllowlisted(item, PHOTO_ITEM_KEYS)) return null;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const receivedAt = typeof item.receivedAt === "string" ? item.receivedAt.trim() : "";
    if (!PHOTO_ID_RE.test(id) || !receivedAt || Number.isNaN(Date.parse(receivedAt))) return null;
    photos.push({ id, receivedAt });
  }
  return photos;
}

export function parseHousekeepingProofReviewPayload(payload: unknown): {
  status: "approved" | "needs_attention";
  reviewedPhotoCount: number;
  idempotent: boolean;
} | null {
  if (!isPlainObject(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== REVIEW_SUCCESS_KEYS.length || !keysAreAllowlisted(payload, REVIEW_SUCCESS_KEYS)) return null;
  if (payload.ok !== true) return null;
  if (payload.status !== "approved" && payload.status !== "needs_attention") return null;
  if (typeof payload.reviewedPhotoCount !== "number" || !Number.isInteger(payload.reviewedPhotoCount)) return null;
  if (payload.reviewedPhotoCount < 0) return null;
  if (typeof payload.idempotent !== "boolean") return null;
  return {
    status: payload.status,
    reviewedPhotoCount: payload.reviewedPhotoCount,
    idempotent: payload.idempotent,
  };
}

export function parseHousekeepingProofIssuePayload(payload: unknown): { path: string; expiresAt: string } | null {
  if (!isPlainObject(payload) || payload.ok !== true) return null;
  if (!keysAreAllowlisted(payload, ISSUE_KEYS)) return null;
  const path = typeof payload.path === "string" ? payload.path : "";
  const expiresAt = typeof payload.expiresAt === "string" ? payload.expiresAt : "";
  if (!isValidHousekeepingProofRelativePath(path) || !expiresAt) return null;
  return { path, expiresAt };
}

export function reservationsForHousekeepingProofProperty(
  reservations: HousekeepingProofHostReservation[],
  propertyId: string,
) {
  return reservations.filter((row) => row.propertyId === propertyId);
}

export function pickHousekeepingProofStage(
  eligibleStages: HousekeepingProofHostStage[],
  current: string,
): HousekeepingProofHostStage | "" {
  if (isStage(current) && eligibleStages.includes(current)) return current;
  return eligibleStages[0] ?? "";
}

export function canStartHousekeepingProofGenerate(input: {
  busy: boolean;
  propertyId: string;
  reservationId: string;
  stage: string;
  eligibleStages: HousekeepingProofHostStage[];
  canIssueLink?: boolean;
}) {
  return (
    !input.busy &&
    Boolean(input.propertyId) &&
    Boolean(input.reservationId) &&
    isStage(input.stage) &&
    input.eligibleStages.includes(input.stage) &&
    input.canIssueLink !== false
  );
}

export function canStartHousekeepingProofReview(input: {
  loadState: "loading" | "ready" | "empty" | "unauthorized" | "unavailable";
  reservationId: string;
  stage: string;
  reviewable: boolean;
  photoCount: number;
  generating: boolean;
  reviewing: boolean;
  galleryLoading: boolean;
  statusLoading: boolean;
}) {
  return (
    input.loadState === "ready" &&
    Boolean(input.reservationId) &&
    isStage(input.stage) &&
    input.reviewable === true &&
    input.photoCount > 0 &&
    !input.generating &&
    !input.reviewing &&
    !input.galleryLoading &&
    !input.statusLoading
  );
}

export function shouldConfirmHousekeepingProofReplace(heldForSelection: boolean) {
  return heldForSelection;
}

export function mapHousekeepingProofHostHttpStatus(status: number): "unauthorized" | "forbidden" | "unavailable" | "ok" {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status >= 200 && status < 300) return "ok";
  return "unavailable";
}

export type HousekeepingProofSharePayload = { title: string; text: string; url: string };
export type HousekeepingProofShareResult = "ignored" | "shared" | "copied" | "cancelled";

export function housekeepingProofSharePayload(url: string): HousekeepingProofSharePayload {
  return {
    title: HOUSEKEEPING_PROOF_HOST_COPY.shareTitle,
    text: HOUSEKEEPING_PROOF_HOST_COPY.shareText,
    url,
  };
}

export function canStartHousekeepingProofShare(url: string, sharing: boolean) {
  return Boolean(url) && !sharing;
}

function isShareAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

export async function executeHousekeepingProofShare(
  url: string,
  sharing: boolean,
  deps: {
    share?: (data: HousekeepingProofSharePayload) => Promise<void>;
    copy: () => Promise<void> | void;
  },
): Promise<HousekeepingProofShareResult> {
  if (!canStartHousekeepingProofShare(url, sharing)) return "ignored";
  if (typeof deps.share === "function") {
    try {
      await deps.share(housekeepingProofSharePayload(url));
      return "shared";
    } catch (error) {
      if (isShareAbortError(error)) return "cancelled";
      await deps.copy();
      return "copied";
    }
  }
  await deps.copy();
  return "copied";
}
