"use client";

import { useEffect, useRef, useState } from "react";
import { publicApiUrl } from "@/lib/public-app-url";

export const GUEST_STAY_ACCESS_PATH = "/api/guest/stay-access";
export const GUEST_STAY_ACCESS_POLL_MS = 60_000;
export const GUEST_STAY_ACCESS_MAX_FIELD_CHARS = 128;
export const GUEST_STAY_ACCESS_SECRET_MASK = "••••••••";

export type GuestStayAccessViewState =
  | "loading"
  | "pending"
  | "ready"
  | "invalid"
  | "expired"
  | "revoked"
  | "unavailable";

export type GuestStayAccessReadyFields = {
  wifiNetwork: string;
  wifiPassword: string;
  doorCode: string;
};

export type GuestStayAccessUi = {
  view: GuestStayAccessViewState;
  fields: GuestStayAccessReadyFields | null;
  showPassword: boolean;
  showDoor: boolean;
  hadValid: boolean;
};

export type GuestStayAccessOutcome =
  | { type: "pending" }
  | { type: "ready"; fields: GuestStayAccessReadyFields }
  | { type: "terminal"; state: "invalid" | "expired" | "revoked" | "unavailable" }
  | { type: "keep" };

export const GUEST_STAY_ACCESS_COPY = {
  titleEn: "Access",
  titleEs: "Acceso",
  loadingEn: "Loading access details…",
  loadingEs: "Cargando datos de acceso…",
  pendingEn: "Available at check-in.",
  pendingEs: "Disponible a partir de la entrada.",
  emptyEn: "Access details are not available yet.",
  emptyEs: "Los datos de acceso todavía no están disponibles.",
  wifiNetworkEn: "Wi-Fi network",
  wifiNetworkEs: "Red Wi-Fi",
  wifiPasswordEn: "Wi-Fi password",
  wifiPasswordEs: "Contraseña Wi-Fi",
  doorEn: "Door code",
  doorEs: "Código de puerta",
  showEn: "Show",
  showEs: "Mostrar",
  hideEn: "Hide",
  hideEs: "Ocultar",
  copyEn: "Copy",
  copyEs: "Copiar",
  copiedEn: "Copied.",
  copiedEs: "Copiado.",
  copyFailEn: "Unable to copy.",
  copyFailEs: "No se pudo copiar.",
  invalidEn: "Access link is invalid.",
  invalidEs: "El enlace de acceso no es válido.",
  revokedEn: "This guest link was replaced. Ask your host for a new link.",
  revokedEs: "Este enlace fue reemplazado. Pídele un enlace nuevo a tu anfitrión.",
  expiredEn: "Access for this stay has expired.",
  expiredEs: "El acceso para esta estadía ha vencido.",
  unavailableEn: "Access details are temporarily unavailable.",
  unavailableEs: "Los datos de acceso no están disponibles temporalmente.",
} as const;

const PENDING_KEYS = ["ok", "status"] as const;
const READY_KEYS = ["ok", "status", "wifiNetwork", "wifiPassword", "doorCode"] as const;

const CONTROL_CLASS =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/40 bg-[#082238] px-3 text-xs font-semibold text-cyan-100 outline-none hover:border-cyan-300/70 focus-visible:ring-2 focus-visible:ring-cyan-300";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isAccessField(value: unknown): value is string {
  return typeof value === "string" && value.length <= GUEST_STAY_ACCESS_MAX_FIELD_CHARS;
}

export function guestStayAccessRequestBody(token: string) {
  return { token };
}

export function guestStayAccessShouldPoll(state: GuestStayAccessViewState) {
  return state === "pending" || state === "ready";
}

export function guestStayAccessShouldKeepLastGood(httpStatus: number) {
  return httpStatus === 429 || httpStatus >= 500;
}

export function guestStayAccessReadyChanged(
  prev: GuestStayAccessReadyFields | null,
  next: GuestStayAccessReadyFields,
) {
  if (!prev) return false;
  return (
    prev.wifiNetwork !== next.wifiNetwork ||
    prev.wifiPassword !== next.wifiPassword ||
    prev.doorCode !== next.doorCode
  );
}

export function guestStayAccessVisibleRows(fields: GuestStayAccessReadyFields) {
  const rows: Array<"wifiNetwork" | "wifiPassword" | "doorCode"> = [];
  if (fields.wifiNetwork !== "") rows.push("wifiNetwork");
  if (fields.wifiPassword !== "") rows.push("wifiPassword");
  if (fields.doorCode !== "") rows.push("doorCode");
  return rows;
}

export function guestStayAccessAllEmpty(fields: GuestStayAccessReadyFields) {
  return guestStayAccessVisibleRows(fields).length === 0;
}

export function parseGuestStayAccessSuccess(payload: unknown) {
  if (!isPlainObject(payload) || payload.ok !== true) return null;
  if (payload.status === "pending") {
    if (!exactKeys(payload, PENDING_KEYS)) return null;
    return { status: "pending" as const };
  }
  if (payload.status === "ready") {
    if (!exactKeys(payload, READY_KEYS)) return null;
    if (!isAccessField(payload.wifiNetwork) || !isAccessField(payload.wifiPassword) || !isAccessField(payload.doorCode)) {
      return null;
    }
    return {
      status: "ready" as const,
      fields: {
        wifiNetwork: payload.wifiNetwork,
        wifiPassword: payload.wifiPassword,
        doorCode: payload.doorCode,
      },
    };
  }
  return null;
}

function parseAccessError(payload: unknown): "invalid" | "expired" | "revoked" | "unavailable" | null {
  if (!isPlainObject(payload)) return null;
  const error = payload.error;
  if (error === "invalid" || error === "expired" || error === "revoked" || error === "unavailable") return error;
  return null;
}

export function classifyGuestStayAccessResponse(input: {
  httpStatus: number;
  payload: unknown;
  hadValid: boolean;
}): GuestStayAccessOutcome {
  if (guestStayAccessShouldKeepLastGood(input.httpStatus)) {
    return input.hadValid ? { type: "keep" } : { type: "terminal", state: "unavailable" };
  }
  if (input.httpStatus === 200) {
    const success = parseGuestStayAccessSuccess(input.payload);
    if (success?.status === "pending") return { type: "pending" };
    if (success?.status === "ready") return { type: "ready", fields: success.fields };
  }
  if (input.httpStatus >= 200 && input.httpStatus < 300) {
    return { type: "terminal", state: "unavailable" };
  }
  const error = parseAccessError(input.payload);
  if (error) return { type: "terminal", state: error };
  return { type: "terminal", state: "unavailable" };
}

export function classifyGuestStayAccessFailure(hadValid: boolean): GuestStayAccessOutcome {
  return hadValid ? { type: "keep" } : { type: "terminal", state: "unavailable" };
}

export function applyGuestStayAccessOutcome(ui: GuestStayAccessUi, outcome: GuestStayAccessOutcome): GuestStayAccessUi {
  if (outcome.type === "keep") return ui;
  if (outcome.type === "pending") {
    return { view: "pending", fields: null, showPassword: false, showDoor: false, hadValid: true };
  }
  if (outcome.type === "ready") {
    const remask = guestStayAccessReadyChanged(ui.fields, outcome.fields);
    return {
      view: "ready",
      fields: outcome.fields,
      showPassword: remask ? false : ui.view === "ready" ? ui.showPassword : false,
      showDoor: remask ? false : ui.view === "ready" ? ui.showDoor : false,
      hadValid: true,
    };
  }
  return {
    view: outcome.state,
    fields: null,
    showPassword: false,
    showDoor: false,
    hadValid: false,
  };
}

export function guestStayAccessSafeMessage(state: GuestStayAccessViewState) {
  if (state === "invalid") return { en: GUEST_STAY_ACCESS_COPY.invalidEn, es: GUEST_STAY_ACCESS_COPY.invalidEs };
  if (state === "revoked") return { en: GUEST_STAY_ACCESS_COPY.revokedEn, es: GUEST_STAY_ACCESS_COPY.revokedEs };
  if (state === "expired") return { en: GUEST_STAY_ACCESS_COPY.expiredEn, es: GUEST_STAY_ACCESS_COPY.expiredEs };
  if (state === "unavailable") return { en: GUEST_STAY_ACCESS_COPY.unavailableEn, es: GUEST_STAY_ACCESS_COPY.unavailableEs };
  if (state === "pending") return { en: GUEST_STAY_ACCESS_COPY.pendingEn, es: GUEST_STAY_ACCESS_COPY.pendingEs };
  if (state === "loading") return { en: GUEST_STAY_ACCESS_COPY.loadingEn, es: GUEST_STAY_ACCESS_COPY.loadingEs };
  return null;
}

export function GuestStayAccessCard({ token }: { token: string }) {
  const [view, setView] = useState<GuestStayAccessViewState>("loading");
  const [fields, setFields] = useState<GuestStayAccessReadyFields | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showDoor, setShowDoor] = useState(false);
  const [notice, setNotice] = useState<"copied" | "copy-fail" | null>(null);
  const accessGen = useRef(0);
  const accessAbort = useRef<AbortController | null>(null);
  const accessInFlight = useRef(false);
  const hadValidRef = useRef(false);
  const fieldsRef = useRef<GuestStayAccessReadyFields | null>(null);
  const viewRef = useRef<GuestStayAccessViewState>("loading");
  const showPasswordRef = useRef(false);
  const showDoorRef = useRef(false);

  function currentUi(): GuestStayAccessUi {
    return {
      view: viewRef.current,
      fields: fieldsRef.current,
      showPassword: showPasswordRef.current,
      showDoor: showDoorRef.current,
      hadValid: hadValidRef.current,
    };
  }

  function applyUi(next: GuestStayAccessUi) {
    viewRef.current = next.view;
    fieldsRef.current = next.fields;
    hadValidRef.current = next.hadValid;
    showPasswordRef.current = next.showPassword;
    showDoorRef.current = next.showDoor;
    setView(next.view);
    setFields(next.fields);
    setShowPassword(next.showPassword);
    setShowDoor(next.showDoor);
    if (next.view !== "ready") setNotice(null);
  }

  async function loadAccess(generation: number, controller: AbortController) {
    accessInFlight.current = true;
    try {
      const response = await fetch(publicApiUrl(GUEST_STAY_ACCESS_PATH), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        cache: "no-store",
        referrer: "no-referrer",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify(guestStayAccessRequestBody(token)),
      });
      if (generation !== accessGen.current) return;
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (controller.signal.aborted || generation !== accessGen.current) return;
        applyUi(applyGuestStayAccessOutcome(currentUi(), classifyGuestStayAccessFailure(hadValidRef.current)));
        return;
      }
      if (controller.signal.aborted || generation !== accessGen.current) return;
      applyUi(
        applyGuestStayAccessOutcome(
          currentUi(),
          classifyGuestStayAccessResponse({
            httpStatus: response.status,
            payload,
            hadValid: hadValidRef.current,
          }),
        ),
      );
    } catch (error) {
      if (controller.signal.aborted || generation !== accessGen.current) return;
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      applyUi(applyGuestStayAccessOutcome(currentUi(), classifyGuestStayAccessFailure(hadValidRef.current)));
    } finally {
      if (generation === accessGen.current) accessInFlight.current = false;
    }
  }

  function startAccessRequest() {
    if (accessInFlight.current) return;
    const generation = accessGen.current + 1;
    accessGen.current = generation;
    accessAbort.current?.abort();
    const controller = new AbortController();
    accessAbort.current = controller;
    void loadAccess(generation, controller);
  }

  useEffect(() => {
    startAccessRequest();
    return () => {
      accessGen.current += 1;
      accessAbort.current?.abort();
      accessInFlight.current = false;
    };
    // Fetch identity is token; startAccessRequest reads the latest token from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!guestStayAccessShouldPoll(view)) return;

    function refresh() {
      if (typeof document !== "undefined" && document.hidden) return;
      if (accessInFlight.current) return;
      startAccessRequest();
    }

    const timer = window.setInterval(() => {
      refresh();
    }, GUEST_STAY_ACCESS_POLL_MS);
    function onVisibility() {
      if (typeof document !== "undefined" && !document.hidden) refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      accessAbort.current?.abort();
      accessInFlight.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Interval is tied to pollable view; startAccessRequest uses refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, token]);

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("copied");
    } catch {
      setNotice("copy-fail");
    }
  }

  const safe = guestStayAccessSafeMessage(view);
  const rows = fields && view === "ready" ? guestStayAccessVisibleRows(fields) : [];
  const showEmpty = view === "ready" && fields !== null && guestStayAccessAllEmpty(fields);

  return (
    <section
      id="guest-stay-access"
      tabIndex={-1}
      aria-labelledby="guest-stay-access-heading"
      className="mt-8 w-full min-w-0 scroll-mt-4 outline-none"
    >
      <article className="rounded-2xl border border-cyan-400/25 bg-[#0d3258]/85 p-4">
        <h2 id="guest-stay-access-heading" className="text-sm font-semibold uppercase tracking-wide text-white">
          {GUEST_STAY_ACCESS_COPY.titleEn}
        </h2>
        <p className="mt-0.5 text-xs text-cyan-200/80">{GUEST_STAY_ACCESS_COPY.titleEs}</p>

        {view === "loading" && safe ? (
          <div className="mt-3">
            <p className="text-sm text-slate-300">{safe.en}</p>
            <p className="mt-1 text-xs text-cyan-200/80">{safe.es}</p>
          </div>
        ) : null}

        {view === "pending" && safe ? (
          <div className="mt-3">
            <p className="text-sm text-slate-300">{safe.en}</p>
            <p className="mt-1 text-sm text-cyan-200/80">{safe.es}</p>
          </div>
        ) : null}

        {view === "ready" && showEmpty ? (
          <div className="mt-3">
            <p className="text-sm text-slate-300">{GUEST_STAY_ACCESS_COPY.emptyEn}</p>
            <p className="mt-1 text-sm text-cyan-200/80">{GUEST_STAY_ACCESS_COPY.emptyEs}</p>
          </div>
        ) : null}

        {view === "ready" && fields && rows.length > 0 ? (
          <ul className="mt-4 space-y-4">
            {rows.includes("wifiNetwork") ? (
              <li>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                  {GUEST_STAY_ACCESS_COPY.wifiNetworkEn} / {GUEST_STAY_ACCESS_COPY.wifiNetworkEs}
                </p>
                <div className="mt-2 flex min-w-0 items-start gap-2">
                  <p className="min-w-0 flex-1 break-words text-base font-semibold text-white">{fields.wifiNetwork}</p>
                  <button type="button" className={CONTROL_CLASS} onClick={() => void copyValue(fields.wifiNetwork)}>
                    {GUEST_STAY_ACCESS_COPY.copyEn} / {GUEST_STAY_ACCESS_COPY.copyEs}
                  </button>
                </div>
              </li>
            ) : null}
            {rows.includes("wifiPassword") ? (
              <li>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                  {GUEST_STAY_ACCESS_COPY.wifiPasswordEn} / {GUEST_STAY_ACCESS_COPY.wifiPasswordEs}
                </p>
                <div className="mt-2 flex min-w-0 items-start gap-2">
                  <p className="min-w-0 flex-1 break-words text-base font-semibold text-white">
                    {showPassword ? fields.wifiPassword : GUEST_STAY_ACCESS_SECRET_MASK}
                  </p>
                  <button
                    type="button"
                    className={CONTROL_CLASS}
                    aria-pressed={showPassword}
                    onClick={() => {
                      setShowPassword((open) => {
                        const next = !open;
                        showPasswordRef.current = next;
                        return next;
                      });
                    }}
                  >
                    {showPassword
                      ? `${GUEST_STAY_ACCESS_COPY.hideEn} / ${GUEST_STAY_ACCESS_COPY.hideEs}`
                      : `${GUEST_STAY_ACCESS_COPY.showEn} / ${GUEST_STAY_ACCESS_COPY.showEs}`}
                  </button>
                  <button type="button" className={CONTROL_CLASS} onClick={() => void copyValue(fields.wifiPassword)}>
                    {GUEST_STAY_ACCESS_COPY.copyEn} / {GUEST_STAY_ACCESS_COPY.copyEs}
                  </button>
                </div>
              </li>
            ) : null}
            {rows.includes("doorCode") ? (
              <li>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                  {GUEST_STAY_ACCESS_COPY.doorEn} / {GUEST_STAY_ACCESS_COPY.doorEs}
                </p>
                <div className="mt-2 flex min-w-0 items-start gap-2">
                  <p className="min-w-0 flex-1 break-words text-base font-semibold text-white">
                    {showDoor ? fields.doorCode : GUEST_STAY_ACCESS_SECRET_MASK}
                  </p>
                  <button
                    type="button"
                    className={CONTROL_CLASS}
                    aria-pressed={showDoor}
                    onClick={() => {
                      setShowDoor((open) => {
                        const next = !open;
                        showDoorRef.current = next;
                        return next;
                      });
                    }}
                  >
                    {showDoor
                      ? `${GUEST_STAY_ACCESS_COPY.hideEn} / ${GUEST_STAY_ACCESS_COPY.hideEs}`
                      : `${GUEST_STAY_ACCESS_COPY.showEn} / ${GUEST_STAY_ACCESS_COPY.showEs}`}
                  </button>
                  <button type="button" className={CONTROL_CLASS} onClick={() => void copyValue(fields.doorCode)}>
                    {GUEST_STAY_ACCESS_COPY.copyEn} / {GUEST_STAY_ACCESS_COPY.copyEs}
                  </button>
                </div>
              </li>
            ) : null}
          </ul>
        ) : null}

        {safe && (view === "invalid" || view === "expired" || view === "revoked" || view === "unavailable") ? (
          <div className="mt-3">
            <p className="text-sm text-slate-300">{safe.en}</p>
            <p className="mt-1 text-sm text-cyan-200/80">{safe.es}</p>
          </div>
        ) : null}

        <p className="mt-3 min-h-5 text-xs text-cyan-200" aria-live="polite">
          {notice === "copied"
            ? `${GUEST_STAY_ACCESS_COPY.copiedEn} ${GUEST_STAY_ACCESS_COPY.copiedEs}`
            : notice === "copy-fail"
              ? `${GUEST_STAY_ACCESS_COPY.copyFailEn} ${GUEST_STAY_ACCESS_COPY.copyFailEs}`
              : ""}
        </p>
      </article>
    </section>
  );
}
