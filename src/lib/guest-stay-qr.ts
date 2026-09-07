import type { Reservation } from "@/lib/dashboard-data";

export const GUEST_STAY_PATH_PREFIX = "/guest/s/";

export const LEGACY_GUEST_LINK_COPY = {
  en: "This guest link is no longer valid. Please request a new secure QR from your host.",
  es: "Este enlace de huésped ya no es válido. Pide a tu anfitrión un código QR seguro nuevo.",
} as const;

export const GUEST_STAY_SHELL_COPY = {
  en: {
    loading: "Checking your stay…",
    activeHint: "Your secure guest portal is active. More stay details will appear here soon.",
    expires: "This link expires automatically at checkout.",
    emergency: "In an emergency, call 911.",
    checkIn: "Check-in",
    checkOut: "Checkout",
    status: "Status",
    active: "Active",
    invalid: "This guest link is not valid.",
    expired: "This guest link has expired.",
    revoked: "This guest link was replaced. Ask your host for a new QR.",
    unavailable: "This guest portal is unavailable right now.",
  },
  es: {
    loading: "Comprobando tu estancia…",
    activeHint: "Tu portal seguro está activo. Pronto verás más detalles de la estancia aquí.",
    expires: "Este enlace caduca automáticamente al check-out.",
    emergency: "En una emergencia, llama al 911.",
    checkIn: "Entrada",
    checkOut: "Salida",
    status: "Estado",
    active: "Activo",
    invalid: "Este enlace de huésped no es válido.",
    expired: "Este enlace de huésped ha caducado.",
    revoked: "Este enlace fue reemplazado. Pide a tu anfitrión un QR nuevo.",
    unavailable: "El portal de huésped no está disponible ahora.",
  },
} as const;

export const HOST_QR_COPY = {
  generate: "Generate secure QR",
  generating: "Generating…",
  pickStay: "Select a current or upcoming reservation",
  loadingStays: "Loading stays…",
  unauthorized: "Host sign-in is required to load stays.",
  unavailable: "Stays are unavailable right now.",
  emptyStays: "No current or upcoming stays",
  replaceWarning:
    "Generating a new QR revokes the previous guest link for this reservation. Continue?",
  scan: "Scan to open your secure guest portal",
  expires: "This link expires automatically at checkout",
  emergency: "In an emergency, call 911.",
  sendToGuest: "Send to guest / Enviar al huésped",
  sending: "Sharing… / Compartiendo…",
  shareTitle: "Secure guest portal / Portal seguro del huésped",
  shareText: "Your secure guest portal / Tu portal seguro de huésped",
  copiedShareFallback:
    "Link copied. Paste it into WhatsApp, Messages, or email. / Enlace copiado. Pégalo en WhatsApp, Mensajes o el correo.",
} as const;

export type HostGuestSharePayload = {
  title: string;
  text: string;
  url: string;
};

export type HostGuestShareResult = "ignored" | "shared" | "copied" | "cancelled";

export function hostGuestSharePayload(guestUrl: string): HostGuestSharePayload {
  return {
    title: HOST_QR_COPY.shareTitle,
    text: HOST_QR_COPY.shareText,
    url: guestUrl,
  };
}

export function canStartGuestShare(guestUrl: string, sharing: boolean) {
  return Boolean(guestUrl) && !sharing;
}

export function isShareAbortError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return "name" in error && (error as { name?: unknown }).name === "AbortError";
}

export async function executeHostGuestShare(
  guestUrl: string,
  sharing: boolean,
  deps: {
    share?: (data: HostGuestSharePayload) => Promise<void>;
    copy: () => Promise<void> | void;
  },
): Promise<HostGuestShareResult> {
  if (!canStartGuestShare(guestUrl, sharing)) return "ignored";
  if (typeof deps.share === "function") {
    try {
      await deps.share(hostGuestSharePayload(guestUrl));
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

export const LIVE_RESERVATION_STAY_COLUMNS = "id, property_id, check_in, check_out, status" as const;

export type LiveReservationMask = {
  id?: unknown;
  property_id?: unknown;
  check_in?: unknown;
  check_out?: unknown;
  status?: unknown;
};

export type HostQrStay = {
  id: string;
  checkIn: string;
  checkOut: string;
  status: string;
};

const HOST_QR_STAY_RESPONSE_KEYS = ["id", "checkIn", "checkOut", "status"] as const;

const HOST_QR_FORBIDDEN_PAYLOAD_KEYS = [
  "guest_name",
  "guest",
  "payout",
  "notes",
  "phone",
  "email",
  "address",
  "access_code",
  "accessCode",
  "property_id",
  "wifi",
  "doorCode",
] as const;

const FORBIDDEN_VISIBLE = [
  "wifi",
  "password",
  "door code",
  "gate code",
  "lockbox",
  "alarm code",
  "handbook",
  "tel:",
  "host / co-host",
  "elena ai",
] as const;

export function todayIsoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isoDateFromUnknown(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? "";
}

export function parseStayLinksPropertyId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80) return null;
  return id;
}

export function hostStayLinksGetGate(userId: string | null | undefined) {
  if (!userId) return { status: 401 as const, body: { error: "Unauthorized" } };
  return null;
}

export function stayLinksEligiblePath(propertyId: string) {
  return `/api/guest/stay-links?propertyId=${encodeURIComponent(propertyId)}`;
}

export function isEligibleQrStayStatus(status: string) {
  const value = status.trim().toLowerCase();
  if (value === "departed" || value === "canceled" || value === "cancelled" || value === "invalid") return false;
  return value === "staying" || value === "arriving" || value === "upcoming";
}

export function mapLiveReservationToHostQrStay(
  row: LiveReservationMask,
  propertyId: string,
  today = todayIsoDate(),
): HostQrStay | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const rowPropertyId = typeof row.property_id === "string" ? row.property_id.trim() : "";
  if (!id || rowPropertyId !== propertyId) return null;
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (!isEligibleQrStayStatus(status)) return null;
  const checkIn = isoDateFromUnknown(row.check_in);
  const checkOut = isoDateFromUnknown(row.check_out);
  if (!checkOut || checkOut < today) return null;
  return { id, checkIn, checkOut, status };
}

export function eligibleHostQrStays(rows: LiveReservationMask[], propertyId: string, today = todayIsoDate()) {
  return rows
    .map((row) => mapLiveReservationToHostQrStay(row, propertyId, today))
    .filter((row): row is HostQrStay => row !== null)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id.localeCompare(b.id));
}

export function hostQrStaysPayload(stays: HostQrStay[]) {
  return {
    stays: stays.map((row) => ({
      id: row.id,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      status: row.status,
    })),
  };
}

export function hostQrStayPayloadHasForbiddenFields(payload: unknown) {
  const json = JSON.stringify(payload);
  if (HOST_QR_FORBIDDEN_PAYLOAD_KEYS.some((key) => new RegExp(`"${key}"`, "i").test(json))) return true;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const stays = (payload as { stays?: unknown }).stays;
  if (!Array.isArray(stays)) return true;
  return stays.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const keys = Object.keys(item);
    return keys.some((key) => !(HOST_QR_STAY_RESPONSE_KEYS as readonly string[]).includes(key));
  });
}

export function parseHostQrStaysResponse(payload: unknown): HostQrStay[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const stays = (payload as { stays?: unknown }).stays;
  if (!Array.isArray(stays)) return null;
  const out: HostQrStay[] = [];
  for (const item of stays) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const checkIn = isoDateFromUnknown(rec.checkIn);
    const checkOut = isoDateFromUnknown(rec.checkOut);
    const status = typeof rec.status === "string" ? rec.status.trim().toLowerCase() : "";
    if (!id || !checkOut || !isEligibleQrStayStatus(status)) continue;
    out.push({ id, checkIn, checkOut, status });
  }
  return out;
}

export function isSelectableStayReservation(reservation: Reservation, propertyId: string, today = todayIsoDate()) {
  if (reservation.propertyId !== propertyId) return false;
  const status = reservation.status.trim().toLowerCase();
  if (status === "departed" || status === "canceled" || status === "cancelled" || status === "invalid") return false;
  if (status !== "staying" && status !== "arriving" && status !== "upcoming") return false;
  if (reservation.checkOut && reservation.checkOut < today) return false;
  return true;
}

export function selectableStayReservations(
  reservations: Reservation[],
  propertyId: string,
  today = todayIsoDate(),
) {
  return reservations
    .filter((row) => isSelectableStayReservation(row, propertyId, today))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

export function buildSecureGuestUrl(origin: string, relativePath: string) {
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  if (!path.startsWith(GUEST_STAY_PATH_PREFIX)) return "";
  const base = origin.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export function stayLinkRequestBody(reservationId: string) {
  return { reservationId };
}

export function canStartStayLinkGenerate(busy: boolean, reservationId: string | null) {
  return Boolean(reservationId) && !busy;
}

export function shouldConfirmStayLinkReplace(alreadyGenerated: boolean) {
  return alreadyGenerated;
}

export function hostQrVisibleCopy(input: {
  propertyName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  guestUrl?: string;
}) {
  return [
    input.propertyName,
    input.city,
    input.checkIn,
    input.checkOut,
    HOST_QR_COPY.scan,
    HOST_QR_COPY.expires,
    HOST_QR_COPY.emergency,
    input.guestUrl ?? "",
  ]
    .join(" ")
    .trim();
}

export function visibleCopyLooksPrivate(text: string) {
  const lower = text.toLowerCase();
  return FORBIDDEN_VISIBLE.some((marker) => lower.includes(marker));
}

export function guestShellLooksPrivate(text: string) {
  const lower = text.toLowerCase();
  return (
    visibleCopyLooksPrivate(text) ||
    /elena|google|local guide|wifi|door code|handbook|@/.test(lower)
  );
}
