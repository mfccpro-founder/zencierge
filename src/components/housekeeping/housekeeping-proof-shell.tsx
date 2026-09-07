"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const HOUSEKEEPING_PROOF_VALIDATE_PATH = "/api/housekeeping/proof";
export const HOUSEKEEPING_PROOF_UPLOAD_PATH = "/api/housekeeping/proof/upload";
export const HOUSEKEEPING_PROOF_SUBMIT_PATH = "/api/housekeeping/proof/submit";
export const HOUSEKEEPING_PROOF_SHELL_STATUS_POLL_MS = 20_000;
export const HOUSEKEEPING_PROOF_CLIENT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const HOUSEKEEPING_PROOF_CLIENT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type HousekeepingProofShellState =
  | "loading"
  | "open"
  | "submitted"
  | "needs_attention"
  | "approved"
  | "invalid"
  | "expired"
  | "revoked"
  | "unavailable";

export type HousekeepingProofPublicStage = "post_checkout" | "ready_for_checkin";
export type HousekeepingProofPublicStatus = "open" | "submitted" | "needs_attention";

export type HousekeepingProofTaskView = {
  propertyName: string;
  city: string;
  stage: HousekeepingProofPublicStage;
  dueAt: string;
  status: HousekeepingProofPublicStatus;
  hasPendingPhotos: boolean;
};

export const HOUSEKEEPING_PROOF_SHELL_COPY = {
  brand: "Zencierge Housekeeping Proof",
  loading: { en: "Loading", es: "Cargando" },
  invalid: { en: "Invalid link", es: "Enlace inválido" },
  expired: { en: "Expired link", es: "Enlace vencido" },
  revoked: { en: "Revoked link", es: "Enlace revocado" },
  unavailable: { en: "Temporarily unavailable", es: "Temporalmente no disponible" },
  approved: {
    en: "Photos approved. No further uploads are needed.",
    es: "Fotos aprobadas. No se necesitan más fotos.",
  },
  photosSent: {
    en: "Photos sent successfully. You may close this page.",
    es: "Fotos enviadas correctamente. Puedes cerrar esta página.",
  },
  finish: { en: "Finish and send", es: "Terminar y enviar" },
  finishing: { en: "Sending…", es: "Enviando…" },
  finishUnavailable: {
    en: "Could not finish and send. Try again.",
    es: "No se pudo terminar y enviar. Inténtalo de nuevo.",
  },
  status: {
    open: { en: "Open", es: "Abierta" },
    submitted: { en: "Submitted", es: "Enviada" },
    needs_attention: { en: "Needs attention", es: "Necesita atención" },
  },
  stage: {
    post_checkout: { en: "Post-checkout inspection", es: "Inspección después de la salida" },
    ready_for_checkin: { en: "Ready for check-in", es: "Preparación para la llegada" },
  },
  due: { en: "Due", es: "Fecha límite" },
  photoGuide: {
    en: "Take clear photos of the bedroom, bathroom, kitchen, and living area.",
    es: "Toma fotos claras del dormitorio, baño, cocina y sala.",
  },
  photoPrivacy: {
    en: "Photos are private and visible only to the authorized host.",
    es: "Las fotos son privadas y solo puede verlas el anfitrión autorizado.",
  },
  takePhoto: { en: "Take or choose photo", es: "Tomar o elegir foto" },
  takeAnother: { en: "Take another photo", es: "Tomar otra foto" },
  upload: { en: "Upload securely", es: "Enviar de forma segura" },
  uploading: { en: "Uploading…", es: "Enviando…" },
  uploaded: { en: "Photo uploaded securely.", es: "Foto enviada de forma segura." },
  previewAlt: "Selected photo",
  uploadInvalid: {
    en: "Photo not accepted. Check the file or request a new link.",
    es: "Foto no aceptada. Revisa el archivo o solicita un enlace nuevo.",
  },
  uploadExpired: {
    en: "This link has expired. Ask the host for a new link.",
    es: "Este enlace venció. Solicita uno nuevo al anfitrión.",
  },
  uploadRevoked: {
    en: "This link was replaced. Ask the host for a new link.",
    es: "Este enlace fue reemplazado. Solicita uno nuevo al anfitrión.",
  },
  uploadUnavailable: {
    en: "Photo upload is temporarily unavailable. Try again later.",
    es: "El envío de fotos no está disponible temporalmente. Intenta más tarde.",
  },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStage(value: unknown): value is HousekeepingProofPublicStage {
  return value === "post_checkout" || value === "ready_for_checkin";
}

function isPublicStatus(value: unknown): value is HousekeepingProofPublicStatus {
  return value === "open" || value === "submitted" || value === "needs_attention";
}

export function housekeepingProofRequestBody(token: string) {
  return { token };
}

export function housekeepingProofPhotoFormData(token: string, photo: File) {
  const form = new FormData();
  form.set("token", token);
  form.set("photo", photo);
  return form;
}

export function formatHousekeepingProofDueAt(dueAt: string) {
  const ms = Date.parse(dueAt);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

export function housekeepingProofShowsTask(
  state: HousekeepingProofShellState,
  task: HousekeepingProofTaskView | null,
): boolean {
  return (state === "open" || state === "submitted" || state === "needs_attention") && task !== null;
}

export function housekeepingProofShowsPhotoCapture(
  state: HousekeepingProofShellState,
  task: HousekeepingProofTaskView | null,
): boolean {
  return (state === "open" || state === "needs_attention") && task !== null;
}

export function housekeepingProofShowsFinish(
  state: HousekeepingProofShellState,
  task: HousekeepingProofTaskView | null,
  sessionHadUpload: boolean,
): boolean {
  if (!housekeepingProofShowsPhotoCapture(state, task) || !task) return false;
  return task.hasPendingPhotos === true || sessionHadUpload === true;
}

export function canStartHousekeepingProofSubmit(input: {
  uploading: boolean;
  submitting: boolean;
  showFinish: boolean;
}) {
  return input.showFinish && !input.uploading && !input.submitting;
}

export function housekeepingProofShellShouldPoll(state: HousekeepingProofShellState) {
  return state === "open" || state === "submitted" || state === "needs_attention";
}

export function housekeepingProofShellShouldKeepLastGood(httpStatus: number) {
  return httpStatus === 429 || httpStatus >= 500;
}

export function canStartHousekeepingProofPhotoUpload(input: { uploading: boolean; file: File | null }) {
  return Boolean(input.file) && !input.uploading;
}

export function housekeepingProofClientPhotoIssue(file: File | null): "empty" | "oversized" | "type" | null {
  if (!file || file.size < 1) return "empty";
  if (file.size > HOUSEKEEPING_PROOF_CLIENT_PHOTO_MAX_BYTES) return "oversized";
  if (!HOUSEKEEPING_PROOF_CLIENT_PHOTO_TYPES.includes(file.type as (typeof HOUSEKEEPING_PROOF_CLIENT_PHOTO_TYPES)[number])) {
    return "type";
  }
  return null;
}

export function interpretHousekeepingProofUploadPayload(
  httpStatus: number,
  payload: unknown,
): "success" | "invalid" | "expired" | "revoked" | "unavailable" {
  if (isPlainObject(payload) && payload.error === "expired") return "expired";
  if (isPlainObject(payload) && payload.error === "revoked") return "revoked";
  if (isPlainObject(payload) && payload.error === "invalid") return "invalid";
  if (isPlainObject(payload) && payload.error === "unavailable") return "unavailable";
  if (httpStatus === 429) return "unavailable";
  if (httpStatus >= 200 && httpStatus < 300 && isPlainObject(payload) && payload.ok === true) return "success";
  return "unavailable";
}

export function interpretHousekeepingProofSubmitPayload(
  httpStatus: number,
  payload: unknown,
): "success" | "invalid" | "expired" | "revoked" | "unavailable" {
  if (isPlainObject(payload) && payload.error === "expired") return "expired";
  if (isPlainObject(payload) && payload.error === "revoked") return "revoked";
  if (isPlainObject(payload) && payload.error === "invalid") return "invalid";
  if (isPlainObject(payload) && payload.error === "unavailable") return "unavailable";
  if (httpStatus === 429) return "unavailable";
  if (
    httpStatus >= 200 &&
    httpStatus < 300 &&
    isPlainObject(payload) &&
    payload.ok === true &&
    payload.status === "submitted" &&
    typeof payload.idempotent === "boolean"
  ) {
    const keys = Object.keys(payload).sort().join(",");
    if (keys !== "idempotent,ok,status") return "unavailable";
    return "success";
  }
  return "unavailable";
}

export function interpretHousekeepingProofShellPayload(
  httpOk: boolean,
  payload: unknown,
): { state: Exclude<HousekeepingProofShellState, "loading">; task: HousekeepingProofTaskView | null } {
  if (!isPlainObject(payload)) {
    return { state: "invalid", task: null };
  }

  if ("error" in payload && payload.error !== undefined) {
    if (payload.error === "expired") return { state: "expired", task: null };
    if (payload.error === "revoked") return { state: "revoked", task: null };
    if (payload.error === "unavailable") return { state: "unavailable", task: null };
    return { state: "invalid", task: null };
  }

  if (!httpOk || payload.ok !== true) {
    return { state: "invalid", task: null };
  }

  if (payload.status === "approved") {
    const keys = Object.keys(payload);
    if (keys.length !== 2 || !keys.includes("ok") || !keys.includes("status")) {
      return { state: "invalid", task: null };
    }
    return { state: "approved", task: null };
  }

  const keys = Object.keys(payload).sort().join(",");
  if (keys !== "city,dueAt,hasPendingPhotos,ok,propertyName,stage,status") {
    return { state: "invalid", task: null };
  }

  const propertyName = payload.propertyName;
  const city = payload.city;
  const dueAt = payload.dueAt;
  const stage = payload.stage;
  const status = payload.status;
  const hasPendingPhotos = payload.hasPendingPhotos;
  if (
    !isString(propertyName) ||
    !isString(city) ||
    !isString(dueAt) ||
    !isStage(stage) ||
    !isPublicStatus(status) ||
    typeof hasPendingPhotos !== "boolean"
  ) {
    return { state: "invalid", task: null };
  }

  return {
    state: status,
    task: {
      propertyName,
      city,
      stage,
      dueAt,
      status,
      hasPendingPhotos,
    },
  };
}

function revokePreview(url: string | null) {
  if (url) URL.revokeObjectURL(url);
}

export function HousekeepingProofShell({ token }: { token: string }) {
  const [state, setState] = useState<HousekeepingProofShellState>("loading");
  const [task, setTask] = useState<HousekeepingProofTaskView | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionHadUpload, setSessionHadUpload] = useState(false);
  const [notice, setNotice] = useState<"success" | "invalid" | "unavailable" | "finishUnavailable" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const submitAbortRef = useRef<AbortController | null>(null);
  const selectionGen = useRef(0);
  const submitGen = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const validateGen = useRef(0);
  const validateAbort = useRef<AbortController | null>(null);
  const validateInFlight = useRef(false);
  const uploadingRef = useRef(false);
  const submittingRef = useRef(false);

  function resetFile() {
    setSelected(null);
    revokePreview(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const enterApprovedState = useCallback(() => {
    validateAbort.current?.abort();
    validateInFlight.current = false;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    submitAbortRef.current?.abort();
    submitAbortRef.current = null;
    selectionGen.current += 1;
    submitGen.current += 1;
    uploadingRef.current = false;
    submittingRef.current = false;
    setUploading(false);
    setSubmitting(false);
    setSelected(null);
    revokePreview(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setNotice(null);
    setSessionHadUpload(false);
    setTask(null);
    setState("approved");
  }, []);

  const enterSubmittedState = useCallback((nextTask: HousekeepingProofTaskView) => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    uploadingRef.current = false;
    setUploading(false);
    selectionGen.current += 1;
    setSelected(null);
    revokePreview(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSessionHadUpload(false);
    setNotice(null);
    setTask({
      ...nextTask,
      status: "submitted",
      hasPendingPhotos: true,
    });
    setState("submitted");
  }, []);

  useEffect(() => {
    const generation = validateGen.current + 1;
    validateGen.current = generation;
    validateAbort.current?.abort();
    const controller = new AbortController();
    validateAbort.current = controller;
    let cancelled = false;
    validateInFlight.current = true;
    void (async () => {
      try {
        const response = await fetch(HOUSEKEEPING_PROOF_VALIDATE_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
          cache: "no-store",
          referrer: "no-referrer",
          signal: controller.signal,
          body: JSON.stringify(housekeepingProofRequestBody(token)),
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (cancelled || generation !== validateGen.current) return;
          setState("invalid");
          setTask(null);
          return;
        }
        if (cancelled) return;
        if (generation !== validateGen.current) return;
        const next = interpretHousekeepingProofShellPayload(response.ok, payload);
        if (next.state === "approved") {
          enterApprovedState();
          return;
        }
        if (next.state === "needs_attention" && next.task && !next.task.hasPendingPhotos) {
          setSessionHadUpload(false);
        }
        setTask(next.task);
        setState(next.state);
      } catch (error) {
        if (controller.signal.aborted || cancelled || generation !== validateGen.current) return;
        if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
        setState("unavailable");
        setTask(null);
      } finally {
        if (generation === validateGen.current) validateInFlight.current = false;
      }
    })();
    return () => {
      cancelled = true;
      selectionGen.current += 1;
      submitGen.current += 1;
      validateGen.current += 1;
      controller.abort();
      validateInFlight.current = false;
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
      revokePreview(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, [token, enterApprovedState]);

  useEffect(() => {
    if (!housekeepingProofShellShouldPoll(state)) return;
    const generation = validateGen.current + 1;
    validateGen.current = generation;

    async function loadStatus() {
      if (generation !== validateGen.current) return;
      if (uploadingRef.current || submittingRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (validateInFlight.current) return;
      validateInFlight.current = true;
      validateAbort.current?.abort();
      const controller = new AbortController();
      validateAbort.current = controller;
      try {
        const response = await fetch(HOUSEKEEPING_PROOF_VALIDATE_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
          cache: "no-store",
          referrer: "no-referrer",
          signal: controller.signal,
          body: JSON.stringify(housekeepingProofRequestBody(token)),
        });
        if (generation !== validateGen.current || uploadingRef.current || submittingRef.current) return;
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (controller.signal.aborted || generation !== validateGen.current) return;
          return;
        }
        if (generation !== validateGen.current || uploadingRef.current || submittingRef.current) return;
        if (housekeepingProofShellShouldKeepLastGood(response.status)) return;
        const next = interpretHousekeepingProofShellPayload(response.ok, payload);
        if (next.state === "approved") {
          enterApprovedState();
          return;
        }
        if (next.state === "needs_attention" && next.task && !next.task.hasPendingPhotos) {
          setSessionHadUpload(false);
        }
        if (next.state === state && next.task?.hasPendingPhotos === task?.hasPendingPhotos) {
          if (next.task) setTask(next.task);
          return;
        }
        setTask(next.task);
        setState(next.state);
      } catch (error) {
        if (controller.signal.aborted || generation !== validateGen.current) return;
        if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      } finally {
        if (generation === validateGen.current) validateInFlight.current = false;
      }
    }

    const timer = window.setInterval(() => {
      void loadStatus();
    }, HOUSEKEEPING_PROOF_SHELL_STATUS_POLL_MS);
    function onVisibility() {
      if (typeof document !== "undefined" && !document.hidden) void loadStatus();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      validateGen.current += 1;
      validateAbort.current?.abort();
      validateInFlight.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state, task?.hasPendingPhotos, token, enterApprovedState]);

  function onPickFile(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    if (fileInputRef.current) fileInputRef.current.value = "";
    selectionGen.current += 1;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    uploadingRef.current = false;
    setUploading(false);
    const issue = housekeepingProofClientPhotoIssue(file);
    if (issue) {
      resetFile();
      setNotice("invalid");
      return;
    }
    revokePreview(previewUrlRef.current);
    const nextPreview = URL.createObjectURL(file as File);
    previewUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setSelected(file);
    setNotice(null);
  }

  async function onUpload() {
    if (!canStartHousekeepingProofPhotoUpload({ uploading, file: selected }) || !selected) return;
    const gen = selectionGen.current;
    validateAbort.current?.abort();
    validateInFlight.current = false;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    uploadingRef.current = true;
    setUploading(true);
    setNotice(null);
    try {
      const response = await fetch(HOUSEKEEPING_PROOF_UPLOAD_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: housekeepingProofPhotoFormData(token, selected),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (controller.signal.aborted || gen !== selectionGen.current) return;
      const outcome = interpretHousekeepingProofUploadPayload(response.status, payload);
      if (outcome === "expired" || outcome === "revoked") {
        resetFile();
        setTask(null);
        setState(outcome);
        setNotice(null);
        return;
      }
      if (outcome === "success") {
        resetFile();
        setSessionHadUpload(true);
        setNotice("success");
        return;
      }
      setNotice(outcome === "invalid" ? "invalid" : "unavailable");
    } catch (error) {
      if (controller.signal.aborted || gen !== selectionGen.current) return;
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      setNotice("unavailable");
    } finally {
      if (gen === selectionGen.current) {
        uploadingRef.current = false;
        setUploading(false);
      }
    }
  }

  async function onFinish() {
    const showFinishNow = housekeepingProofShowsFinish(state, task, sessionHadUpload);
    if (!canStartHousekeepingProofSubmit({ uploading, submitting, showFinish: showFinishNow }) || !task) return;
    const gen = submitGen.current + 1;
    submitGen.current = gen;
    validateAbort.current?.abort();
    validateInFlight.current = false;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    uploadingRef.current = false;
    setUploading(false);
    const controller = new AbortController();
    submitAbortRef.current = controller;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch(HOUSEKEEPING_PROOF_SUBMIT_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        cache: "no-store",
        credentials: "omit",
        referrer: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify(housekeepingProofRequestBody(token)),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (controller.signal.aborted || gen !== submitGen.current) return;
      const outcome = interpretHousekeepingProofSubmitPayload(response.status, payload);
      if (outcome === "expired" || outcome === "revoked") {
        resetFile();
        setTask(null);
        setState(outcome);
        setNotice(null);
        return;
      }
      if (outcome === "success") {
        enterSubmittedState(task);
        return;
      }
      setNotice("finishUnavailable");
    } catch (error) {
      if (controller.signal.aborted || gen !== submitGen.current) return;
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      setNotice("finishUnavailable");
    } finally {
      if (gen === submitGen.current) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  const message =
    state === "loading"
      ? HOUSEKEEPING_PROOF_SHELL_COPY.loading
      : state === "expired"
        ? HOUSEKEEPING_PROOF_SHELL_COPY.uploadExpired
        : state === "revoked"
          ? HOUSEKEEPING_PROOF_SHELL_COPY.uploadRevoked
          : state === "unavailable"
            ? HOUSEKEEPING_PROOF_SHELL_COPY.unavailable
            : state === "approved"
              ? HOUSEKEEPING_PROOF_SHELL_COPY.approved
              : state === "invalid"
                ? HOUSEKEEPING_PROOF_SHELL_COPY.invalid
                : null;

  const showTask = housekeepingProofShowsTask(state, task);
  const showPhotos = housekeepingProofShowsPhotoCapture(state, task);
  const showFinish = housekeepingProofShowsFinish(state, task, sessionHadUpload);
  const finishEnabled = canStartHousekeepingProofSubmit({ uploading, submitting, showFinish });
  const dueLabel = showTask && task ? formatHousekeepingProofDueAt(task.dueAt) : null;
  const stageCopy = showTask && task ? HOUSEKEEPING_PROOF_SHELL_COPY.stage[task.stage] : null;
  const statusCopy = showTask && task ? HOUSEKEEPING_PROOF_SHELL_COPY.status[task.status] : null;
  const pickCopy = selected || notice === "success" ? HOUSEKEEPING_PROOF_SHELL_COPY.takeAnother : HOUSEKEEPING_PROOF_SHELL_COPY.takePhoto;
  const captureBusy = uploading || submitting;

  return (
    <div className="relative z-10 min-h-dvh w-full min-w-0 overflow-x-hidden bg-gradient-to-b from-[#071833] via-[#0b2a4a] to-[#082238] text-slate-100 touch-manipulation">
      <div className="mx-auto w-full min-w-0 max-w-md px-4 pb-24 pt-8 sm:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300/90">
          {HOUSEKEEPING_PROOF_SHELL_COPY.brand}
        </p>
        {showTask && task && stageCopy && statusCopy ? (
          <>
            <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {task.propertyName.trim() || HOUSEKEEPING_PROOF_SHELL_COPY.brand}
            </h1>
            <p className="mt-2 text-sm text-slate-300">{task.city}</p>
            <div className="mt-6 space-y-3">
              <div className="rounded-2xl border border-cyan-400/25 bg-[#0d3258]/85 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Stage</p>
                <p className="mt-1 text-base font-semibold text-white">{stageCopy.en}</p>
                <p className="mt-1 text-sm text-cyan-200/80">{stageCopy.es}</p>
              </div>
              {dueLabel ? (
                <div className="rounded-2xl border border-cyan-400/25 bg-[#0d3258]/85 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                    {HOUSEKEEPING_PROOF_SHELL_COPY.due.en} / {HOUSEKEEPING_PROOF_SHELL_COPY.due.es}
                  </p>
                  <p className="mt-1 text-base font-semibold text-white">{dueLabel}</p>
                </div>
              ) : null}
              <div className="rounded-2xl border border-cyan-400/35 bg-cyan-500/10 p-4" aria-live="polite">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">Status</p>
                <p className="mt-1 text-base font-semibold text-cyan-50">{statusCopy.en}</p>
                <p className="mt-1 text-sm text-cyan-100/80">{statusCopy.es}</p>
              </div>
            </div>
            {state === "submitted" ? (
              <div className="mt-8 rounded-2xl border border-cyan-400/35 bg-cyan-500/10 p-4" aria-live="polite">
                <p className="text-sm font-semibold text-cyan-50">{HOUSEKEEPING_PROOF_SHELL_COPY.photosSent.en}</p>
                <p className="mt-1 text-sm text-cyan-100/80">{HOUSEKEEPING_PROOF_SHELL_COPY.photosSent.es}</p>
              </div>
            ) : null}
            {showPhotos ? (
              <div className="mt-8 space-y-4">
                <p className="text-sm leading-relaxed text-slate-300">{HOUSEKEEPING_PROOF_SHELL_COPY.photoGuide.en}</p>
                <p className="text-sm leading-relaxed text-cyan-200/80">{HOUSEKEEPING_PROOF_SHELL_COPY.photoGuide.es}</p>
                <p className="text-sm leading-relaxed text-slate-300">{HOUSEKEEPING_PROOF_SHELL_COPY.photoPrivacy.en}</p>
                <p className="text-sm leading-relaxed text-cyan-200/80">{HOUSEKEEPING_PROOF_SHELL_COPY.photoPrivacy.es}</p>
                {previewUrl ? (
                  // Local blob preview only; next/image is not used for object URLs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={HOUSEKEEPING_PROOF_SHELL_COPY.previewAlt}
                    className="mt-2 max-h-56 w-full rounded-2xl border border-cyan-400/25 object-cover"
                  />
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="sr-only"
                  disabled={captureBusy}
                  onChange={(event) => onPickFile(event.target.files)}
                />
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-cyan-400/40 bg-[#0d3258] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={captureBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span>
                    {pickCopy.en}
                    <span className="mt-1 block text-xs font-normal text-cyan-200/80">{pickCopy.es}</span>
                  </span>
                </button>
                {selected ? (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-center rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#071833] disabled:opacity-60"
                    disabled={captureBusy}
                    aria-busy={uploading}
                    onClick={() => void onUpload()}
                  >
                    <span>
                      {uploading ? HOUSEKEEPING_PROOF_SHELL_COPY.uploading.en : HOUSEKEEPING_PROOF_SHELL_COPY.upload.en}
                      <span className="mt-1 block text-xs font-normal text-[#082238]/80">
                        {uploading ? HOUSEKEEPING_PROOF_SHELL_COPY.uploading.es : HOUSEKEEPING_PROOF_SHELL_COPY.upload.es}
                      </span>
                    </span>
                  </button>
                ) : null}
                {showFinish ? (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-cyan-300 bg-cyan-400/20 px-4 py-3 text-sm font-semibold text-cyan-50 disabled:opacity-60"
                    disabled={!finishEnabled}
                    aria-busy={submitting}
                    onClick={() => void onFinish()}
                  >
                    <span>
                      {submitting ? HOUSEKEEPING_PROOF_SHELL_COPY.finishing.en : HOUSEKEEPING_PROOF_SHELL_COPY.finish.en}
                      <span className="mt-1 block text-xs font-normal text-cyan-100/80">
                        {submitting ? HOUSEKEEPING_PROOF_SHELL_COPY.finishing.es : HOUSEKEEPING_PROOF_SHELL_COPY.finish.es}
                      </span>
                    </span>
                  </button>
                ) : null}
                <div aria-live="polite">
                  {notice === "success" ? (
                    <>
                      <p className="text-sm text-cyan-100">{HOUSEKEEPING_PROOF_SHELL_COPY.uploaded.en}</p>
                      <p className="mt-1 text-sm text-cyan-200/80">{HOUSEKEEPING_PROOF_SHELL_COPY.uploaded.es}</p>
                    </>
                  ) : null}
                  {notice === "invalid" ? (
                    <>
                      <p className="text-sm text-rose-100">{HOUSEKEEPING_PROOF_SHELL_COPY.uploadInvalid.en}</p>
                      <p className="mt-1 text-sm text-rose-200/80">{HOUSEKEEPING_PROOF_SHELL_COPY.uploadInvalid.es}</p>
                    </>
                  ) : null}
                  {notice === "unavailable" ? (
                    <>
                      <p className="text-sm text-rose-100">{HOUSEKEEPING_PROOF_SHELL_COPY.uploadUnavailable.en}</p>
                      <p className="mt-1 text-sm text-rose-200/80">{HOUSEKEEPING_PROOF_SHELL_COPY.uploadUnavailable.es}</p>
                    </>
                  ) : null}
                  {notice === "finishUnavailable" ? (
                    <>
                      <p className="text-sm text-rose-100">{HOUSEKEEPING_PROOF_SHELL_COPY.finishUnavailable.en}</p>
                      <p className="mt-1 text-sm text-rose-200/80">{HOUSEKEEPING_PROOF_SHELL_COPY.finishUnavailable.es}</p>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div aria-live="polite" aria-busy={state === "loading"}>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {HOUSEKEEPING_PROOF_SHELL_COPY.brand}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">{message?.en}</p>
            <p className="mt-2 text-sm leading-relaxed text-cyan-200/80">{message?.es}</p>
          </div>
        )}
      </div>
    </div>
  );
}
