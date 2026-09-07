"use client";

import { useEffect, useRef, useState } from "react";
import { resolveReachableAppOrigin } from "@/lib/public-app-url";
import {
  HOUSEKEEPING_PROOF_HOST_COPY,
  HOUSEKEEPING_PROOF_HOST_ISSUE_PATH,
  HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH,
  HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_PATH,
  HOUSEKEEPING_PROOF_HOST_PHOTO_MAX,
  HOUSEKEEPING_PROOF_HOST_PHOTO_REVIEW_PATH,
  HOUSEKEEPING_PROOF_HOST_PHOTO_STATUS_PATH,
  buildHousekeepingProofAbsoluteUrl,
  canStartHousekeepingProofGenerate,
  canStartHousekeepingProofReview,
  canStartHousekeepingProofShare,
  chooseHousekeepingProofShareOrigin,
  executeHousekeepingProofShare,
  formatHousekeepingProofReceivedAt,
  housekeepingProofHostIssueBody,
  housekeepingProofHostPhotoBytesPath,
  housekeepingProofHostPhotoPollIntervalMs,
  housekeepingProofHostPhotoQuery,
  housekeepingProofHostReviewBody,
  mapHousekeepingProofHostHttpStatus,
  parseHousekeepingProofIssuePayload,
  parseHousekeepingProofOptionsPayload,
  parseHousekeepingProofPhotoListPayload,
  parseHousekeepingProofPhotoStatusPayload,
  parseHousekeepingProofReviewPayload,
  pickHousekeepingProofStage,
  reservationsForHousekeepingProofProperty,
  shouldConfirmHousekeepingProofReplace,
  type HousekeepingProofHostProperty,
  type HousekeepingProofHostReservation,
  type HousekeepingProofHostReviewDecision,
  type HousekeepingProofHostStage,
  type HousekeepingProofSharePayload,
} from "@/lib/housekeeping-proof-host";

type LoadState = "loading" | "ready" | "empty" | "unauthorized" | "unavailable";
type Notice =
  | "copied"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "generateCancelled"
  | "generateSubmittedBlocked"
  | "reviewApproved"
  | "reviewNeedsAttention"
  | "reviewForbidden"
  | "reviewSaveFailed"
  | null;

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900";

export function HousekeepingProofLinkCard() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [properties, setProperties] = useState<HousekeepingProofHostProperty[]>([]);
  const [reservations, setReservations] = useState<HousekeepingProofHostReservation[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [stage, setStage] = useState<HousekeepingProofHostStage | "">("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [hasLink, setHasLink] = useState(false);
  const [shareReady, setShareReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [reviewable, setReviewable] = useState(false);
  const [canIssueLink, setCanIssueLink] = useState(true);
  const [latestReceivedAt, setLatestReceivedAt] = useState<string | null>(null);
  const [photoStatusUnavailable, setPhotoStatusUnavailable] = useState(false);
  const [, setStatusLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<HousekeepingProofHostReviewDecision | null>(null);
  const [statusEpoch, setStatusEpoch] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryUnavailable, setGalleryUnavailable] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState<{ id: string; receivedAt: string }[]>([]);
  const [expandedPhotoKey, setExpandedPhotoKey] = useState("");
  const pathRef = useRef("");
  const urlRef = useRef("");
  const optionsGen = useRef(0);
  const generateGen = useRef(0);
  const generateAbort = useRef<AbortController | null>(null);
  const generatingRef = useRef(false);
  const sharingRef = useRef(false);
  const statusGen = useRef(0);
  const statusAbort = useRef<AbortController | null>(null);
  const statusInFlight = useRef(false);
  const galleryGen = useRef(0);
  const galleryAbort = useRef<AbortController | null>(null);
  const reviewGen = useRef(0);
  const reviewAbort = useRef<AbortController | null>(null);
  const reviewingRef = useRef(false);

  useEffect(() => {
    const generation = optionsGen.current + 1;
    optionsGen.current = generation;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (generation !== optionsGen.current) return;
        const mapped = mapHousekeepingProofHostHttpStatus(response.status);
        if (mapped === "unauthorized") {
          setLoadState("unauthorized");
          return;
        }
        if (mapped !== "ok") {
          setLoadState("unavailable");
          return;
        }
        const payload: unknown = await response.json();
        if (generation !== optionsGen.current) return;
        const parsed = parseHousekeepingProofOptionsPayload(payload);
        if (!parsed) {
          setLoadState("unavailable");
          return;
        }
        setProperties(parsed.properties);
        setReservations(parsed.reservations);
        setLoadState(parsed.reservations.length ? "ready" : "empty");
      } catch (error) {
        if (controller.signal.aborted || generation !== optionsGen.current) return;
        void error;
        setLoadState("unavailable");
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  const effectivePropertyId = properties.some((row) => row.id === propertyId) ? propertyId : (properties[0]?.id ?? "");
  const stays = reservationsForHousekeepingProofProperty(reservations, effectivePropertyId);
  const effectiveReservationId = stays.some((row) => row.id === reservationId) ? reservationId : (stays[0]?.id ?? "");
  const selectedStay = stays.find((row) => row.id === effectiveReservationId) ?? null;
  const effectiveStage = pickHousekeepingProofStage(selectedStay?.eligibleStages ?? [], stage);

  function clearReviewRequest() {
    reviewAbort.current?.abort();
    reviewAbort.current = null;
    reviewGen.current += 1;
    reviewingRef.current = false;
    setReviewing(false);
    setReviewDecision(null);
  }

  function clearReviewState() {
    clearReviewRequest();
    statusAbort.current?.abort();
    statusAbort.current = null;
    statusGen.current += 1;
    statusInFlight.current = false;
    setStatusLoading(false);
    galleryAbort.current?.abort();
    galleryAbort.current = null;
    galleryGen.current += 1;
    setPhotoCount(0);
    setReviewable(false);
    setCanIssueLink(true);
    setLatestReceivedAt(null);
    setPhotoStatusUnavailable(false);
    setGalleryOpen(false);
    setGalleryLoading(false);
    setGalleryUnavailable(false);
    setGalleryPhotos([]);
    setExpandedPhotoKey("");
  }

  function clearHeldLink() {
    generateAbort.current?.abort();
    generateAbort.current = null;
    generateGen.current += 1;
    pathRef.current = "";
    urlRef.current = "";
    setHasLink(false);
    setShareReady(false);
    setBusy(false);
    generatingRef.current = false;
    clearReviewState();
  }

  useEffect(() => {
    return () => {
      generateAbort.current?.abort();
      statusAbort.current?.abort();
      galleryAbort.current?.abort();
      reviewAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (loadState !== "ready" || !effectiveReservationId || !effectiveStage) {
      return;
    }
    const reservationId = effectiveReservationId;
    const stage = effectiveStage;
    const generation = statusGen.current + 1;
    statusGen.current = generation;
    statusInFlight.current = false;

    async function loadStatus() {
      if (generation !== statusGen.current) return;
      if (reviewingRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (statusInFlight.current) return;
      statusInFlight.current = true;
      setStatusLoading(true);
      statusAbort.current?.abort();
      const controller = new AbortController();
      statusAbort.current = controller;
      try {
        const response = await fetch(
          `${HOUSEKEEPING_PROOF_HOST_PHOTO_STATUS_PATH}?${housekeepingProofHostPhotoQuery(reservationId, stage)}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          },
        );
        if (generation !== statusGen.current || reviewingRef.current) return;
        const mapped = mapHousekeepingProofHostHttpStatus(response.status);
        if (mapped !== "ok") {
          setPhotoStatusUnavailable(true);
          return;
        }
        const payload: unknown = await response.json();
        if (generation !== statusGen.current || reviewingRef.current) return;
        const parsed = parseHousekeepingProofPhotoStatusPayload(payload);
        if (!parsed) {
          setPhotoStatusUnavailable(true);
          return;
        }
        setPhotoCount(parsed.photoCount);
        setReviewable(parsed.reviewable);
        setCanIssueLink(parsed.canIssueLink);
        setLatestReceivedAt(parsed.latestReceivedAt);
        setPhotoStatusUnavailable(false);
        if (parsed.photoCount === 0) {
          setGalleryOpen(false);
          setGalleryPhotos([]);
          setExpandedPhotoKey("");
        }
      } catch (error) {
        if (controller.signal.aborted || generation !== statusGen.current) return;
        void error;
        setPhotoStatusUnavailable(true);
      } finally {
        if (generation === statusGen.current) {
          statusInFlight.current = false;
          setStatusLoading(false);
        }
      }
    }

    void loadStatus();
    const pollMs = housekeepingProofHostPhotoPollIntervalMs(photoCount);
    const timer = window.setInterval(() => {
      void loadStatus();
    }, pollMs);
    function onVisibility() {
      if (typeof document !== "undefined" && !document.hidden) void loadStatus();
    }
    function onFocus() {
      void loadStatus();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      statusGen.current += 1;
      statusAbort.current?.abort();
      statusInFlight.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadState, effectiveReservationId, effectiveStage, statusEpoch, photoCount]);

  async function resolveShareUrl(path: string) {
    const reachable = await resolveReachableAppOrigin();
    const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";
    const origin = chooseHousekeepingProofShareOrigin(pageOrigin, reachable);
    return buildHousekeepingProofAbsoluteUrl(origin, path);
  }

  async function onGenerate() {
    const eligible = selectedStay?.eligibleStages ?? [];
    if (
      !canStartHousekeepingProofGenerate({
        busy: busy || generatingRef.current || reviewing || reviewingRef.current,
        propertyId: effectivePropertyId,
        reservationId: effectiveReservationId,
        stage: effectiveStage,
        eligibleStages: eligible,
        canIssueLink,
      }) ||
      !effectiveStage
    ) {
      return;
    }
    if (shouldConfirmHousekeepingProofReplace(Boolean(pathRef.current)) && !window.confirm(`${HOUSEKEEPING_PROOF_HOST_COPY.replace.en}\n${HOUSEKEEPING_PROOF_HOST_COPY.replace.es}`)) {
      setNotice("generateCancelled");
      return;
    }
    const previousPath = pathRef.current;
    const previousUrl = urlRef.current;
    const gen = generateGen.current + 1;
    generateGen.current = gen;
    generateAbort.current?.abort();
    const controller = new AbortController();
    generateAbort.current = controller;
    clearReviewRequest();
    generatingRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(HOUSEKEEPING_PROOF_HOST_ISSUE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify(housekeepingProofHostIssueBody(effectiveReservationId, effectiveStage)),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (controller.signal.aborted || gen !== generateGen.current) return;
      const mapped = mapHousekeepingProofHostHttpStatus(response.status);
      const parsed = parseHousekeepingProofIssuePayload(payload);
      if (mapped !== "ok" || !parsed) {
        pathRef.current = previousPath;
        urlRef.current = previousUrl;
        setHasLink(Boolean(previousPath));
        setShareReady(Boolean(previousUrl));
        if (response.status === 409) {
          const err =
            payload && typeof payload === "object" && payload !== null && "error" in payload
              ? (payload as { error?: unknown }).error
              : null;
          if (err === "submitted") {
            setCanIssueLink(false);
            setNotice("generateSubmittedBlocked");
            return;
          }
        }
        setNotice(mapped === "unauthorized" ? "unauthorized" : mapped === "forbidden" ? "forbidden" : "unavailable");
        return;
      }
      const url = await resolveShareUrl(parsed.path);
      if (controller.signal.aborted || gen !== generateGen.current) return;
      pathRef.current = parsed.path;
      urlRef.current = url;
      setHasLink(true);
      setShareReady(Boolean(url));
    } catch (error) {
      if (controller.signal.aborted || gen !== generateGen.current) return;
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      pathRef.current = previousPath;
      urlRef.current = previousUrl;
      setHasLink(Boolean(previousPath));
      setShareReady(Boolean(previousUrl));
      setNotice("unavailable");
    } finally {
      if (gen === generateGen.current) {
        generatingRef.current = false;
        setBusy(false);
      }
    }
  }

  async function copyHeldUrl() {
    const url = urlRef.current || (pathRef.current ? await resolveShareUrl(pathRef.current) : "");
    if (!url) return;
    urlRef.current = url;
    setShareReady(true);
    await navigator.clipboard.writeText(url);
    setNotice("copied");
  }

  async function onShare() {
    const url = urlRef.current || (pathRef.current ? await resolveShareUrl(pathRef.current) : "");
    if (!canStartHousekeepingProofShare(url, sharing || sharingRef.current)) return;
    urlRef.current = url;
    sharingRef.current = true;
    setSharing(true);
    try {
      const nativeShare =
        typeof navigator !== "undefined" && typeof navigator.share === "function"
          ? (data: HousekeepingProofSharePayload) => navigator.share(data)
          : undefined;
      const outcome = await executeHousekeepingProofShare(url, false, {
        share: nativeShare,
        copy: copyHeldUrl,
      });
      if (outcome === "copied") setNotice("copied");
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  }

  async function onDecide(decision: HousekeepingProofHostReviewDecision) {
    const reviewInput = {
      loadState,
      reservationId: effectiveReservationId,
      stage: effectiveStage,
      reviewable,
      photoCount,
      generating: busy || generatingRef.current,
      reviewing: reviewing || reviewingRef.current,
      galleryLoading,
      // Background status polls must never silently block a real decision click.
      statusLoading: false,
    };
    if (!canStartHousekeepingProofReview(reviewInput) || !effectiveStage) return;
    if (
      decision === "approve" &&
      !window.confirm(`${HOUSEKEEPING_PROOF_HOST_COPY.approveConfirm.en}\n${HOUSEKEEPING_PROOF_HOST_COPY.approveConfirm.es}`)
    ) {
      return;
    }
    const reservationId = effectiveReservationId;
    const stage = effectiveStage;
    // Invalidate any in-flight status poll before the review POST.
    statusAbort.current?.abort();
    statusAbort.current = null;
    statusGen.current += 1;
    statusInFlight.current = false;
    setStatusLoading(false);
    galleryAbort.current?.abort();
    galleryAbort.current = null;
    galleryGen.current += 1;
    setGalleryLoading(false);
    const gen = reviewGen.current + 1;
    reviewGen.current = gen;
    reviewAbort.current?.abort();
    const controller = new AbortController();
    reviewAbort.current = controller;
    reviewingRef.current = true;
    setReviewing(true);
    setReviewDecision(decision);
    setNotice(null);
    try {
      const response = await fetch(HOUSEKEEPING_PROOF_HOST_PHOTO_REVIEW_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify(housekeepingProofHostReviewBody(reservationId, stage, decision)),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (controller.signal.aborted || gen !== reviewGen.current) return;
      const mapped = mapHousekeepingProofHostHttpStatus(response.status);
      const parsed = parseHousekeepingProofReviewPayload(payload);
      if (mapped !== "ok" || !parsed) {
        setNotice(
          mapped === "unauthorized" ? "unauthorized" : mapped === "forbidden" ? "reviewForbidden" : "reviewSaveFailed",
        );
        return;
      }
      setGalleryOpen(false);
      setGalleryPhotos([]);
      setGalleryUnavailable(false);
      setExpandedPhotoKey("");
      setPhotoCount(0);
      setReviewable(false);
      setLatestReceivedAt(null);
      if (parsed.status === "approved") {
        // Keep Property/Stay/Stage controls available for the next cleaning.
        // Do not refresh options here: filtering out the approved terminal stage can
        // empty the stay list and hide the whole ready UI.
        setCanIssueLink(false);
        pathRef.current = "";
        urlRef.current = "";
        setHasLink(false);
        setShareReady(false);
        setNotice("reviewApproved");
      } else {
        setCanIssueLink(true);
        setNotice("reviewNeedsAttention");
      }
    } catch (error) {
      if (controller.signal.aborted || gen !== reviewGen.current) return;
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      setNotice("reviewSaveFailed");
    } finally {
      if (gen === reviewGen.current) {
        reviewingRef.current = false;
        setReviewing(false);
        setReviewDecision(null);
        setStatusEpoch((current) => current + 1);
      }
    }
  }

  async function onReview() {
    if (!effectiveReservationId || !effectiveStage || photoCount <= 0 || galleryLoading || reviewingRef.current) return;
    const generation = galleryGen.current + 1;
    galleryGen.current = generation;
    galleryAbort.current?.abort();
    const controller = new AbortController();
    galleryAbort.current = controller;
    setGalleryLoading(true);
    setGalleryUnavailable(false);
    setGalleryOpen(true);
    try {
      const response = await fetch(
        `${HOUSEKEEPING_PROOF_HOST_PHOTO_LIST_PATH}?${housekeepingProofHostPhotoQuery(effectiveReservationId, effectiveStage)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        },
      );
      if (generation !== galleryGen.current || reviewingRef.current) return;
      const mapped = mapHousekeepingProofHostHttpStatus(response.status);
      const payload: unknown = mapped === "ok" ? await response.json() : null;
      if (generation !== galleryGen.current || reviewingRef.current) return;
      const parsed = payload ? parseHousekeepingProofPhotoListPayload(payload) : null;
      if (!parsed) {
        setGalleryUnavailable(true);
        setGalleryPhotos([]);
        setExpandedPhotoKey("");
        return;
      }
      setGalleryPhotos(parsed);
      setExpandedPhotoKey((current) => (current && parsed.some((row) => row.id === current) ? current : ""));
      setGalleryUnavailable(false);
    } catch (error) {
      if (controller.signal.aborted || generation !== galleryGen.current) return;
      void error;
      setGalleryUnavailable(true);
      setGalleryPhotos([]);
      setExpandedPhotoKey("");
    } finally {
      if (generation === galleryGen.current) setGalleryLoading(false);
    }
  }

  const controlsLocked = busy || reviewing;
  const shellVisible = loadState === "ready" || loadState === "empty";
  const noEligibleStays = loadState === "empty";
  const generateEnabled = canStartHousekeepingProofGenerate({
    busy: controlsLocked,
    propertyId: effectivePropertyId,
    reservationId: effectiveReservationId,
    stage: effectiveStage,
    eligibleStages: selectedStay?.eligibleStages ?? [],
    canIssueLink,
  });
  const shareEnabled = hasLink && shareReady && !sharing && !controlsLocked && !noEligibleStays;
  const reviewActionsVisible =
    loadState === "ready" && Boolean(effectiveReservationId) && Boolean(effectiveStage) && photoCount > 0;
  const awaitingFinish = reviewActionsVisible && !reviewable;
  const submissionReceived = reviewActionsVisible && reviewable;
  const reviewActionGate = {
    loadState,
    reservationId: effectiveReservationId,
    stage: effectiveStage,
    reviewable,
    photoCount,
    generating: busy,
    reviewing,
    galleryLoading,
    // Poll busy must not disable Approve / Needs attention (no-blink + clickable).
    statusLoading: false,
  };
  const reviewActionsEnabled = canStartHousekeepingProofReview(reviewActionGate);
  /** Fade only for real blockers; background status polls stay full opacity and clickable. */
  const reviewActionsVisuallyMuted = !reviewActionsEnabled;
  const reviewDecisionButtonClass = `inline-flex min-h-11 flex-1 items-center justify-center rounded-xl px-4 text-sm font-bold disabled:cursor-not-allowed${
    reviewActionsVisuallyMuted ? " disabled:opacity-40" : ""
  }`;
  const statusCopy =
    notice === "copied"
      ? HOUSEKEEPING_PROOF_HOST_COPY.copied
      : notice === "generateCancelled"
        ? HOUSEKEEPING_PROOF_HOST_COPY.generateCancelled
        : notice === "generateSubmittedBlocked"
          ? HOUSEKEEPING_PROOF_HOST_COPY.generateSubmittedBlocked
      : notice === "reviewApproved"
        ? HOUSEKEEPING_PROOF_HOST_COPY.reviewApproved
        : notice === "reviewNeedsAttention"
          ? HOUSEKEEPING_PROOF_HOST_COPY.reviewNeedsAttention
          : notice === "reviewForbidden"
            ? HOUSEKEEPING_PROOF_HOST_COPY.reviewForbidden
              : notice === "reviewSaveFailed"
                ? HOUSEKEEPING_PROOF_HOST_COPY.reviewSaveFailed
              : notice === "unauthorized" || loadState === "unauthorized"
                ? HOUSEKEEPING_PROOF_HOST_COPY.unauthorized
                : notice === "forbidden"
                  ? HOUSEKEEPING_PROOF_HOST_COPY.forbidden
                  : notice === "unavailable" || loadState === "unavailable"
                    ? HOUSEKEEPING_PROOF_HOST_COPY.unavailable
                    : loadState === "empty"
                      ? HOUSEKEEPING_PROOF_HOST_COPY.empty
                      : null;

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 sm:p-5">
      <h2 className="text-base font-bold text-slate-900">{HOUSEKEEPING_PROOF_HOST_COPY.title.en}</h2>
      <p className="mt-0.5 text-sm font-medium text-sky-900">{HOUSEKEEPING_PROOF_HOST_COPY.title.es}</p>
      <p className="mt-2 text-sm text-slate-700">{HOUSEKEEPING_PROOF_HOST_COPY.help.en}</p>
      <p className="mt-1 text-sm text-slate-600">{HOUSEKEEPING_PROOF_HOST_COPY.help.es}</p>

      {shellVisible ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-slate-800">
            Property / Propiedad
            <select
              className={fieldClass}
              value={effectivePropertyId}
              disabled={controlsLocked || noEligibleStays || !properties.length}
              onChange={(event) => {
                clearHeldLink();
                setPropertyId(event.target.value);
              }}
            >
              {properties.length ? (
                properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))
              ) : (
                <option value="">{HOUSEKEEPING_PROOF_HOST_COPY.empty.en}</option>
              )}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-800">
            Stay / Estadía
            <select
              className={fieldClass}
              value={effectiveReservationId}
              disabled={controlsLocked || noEligibleStays || !stays.length}
              onChange={(event) => {
                clearHeldLink();
                setReservationId(event.target.value);
              }}
            >
              {stays.length ? (
                stays.map((stay) => (
                  <option key={stay.id} value={stay.id}>
                    {stay.checkIn} → {stay.checkOut} · {stay.status}
                  </option>
                ))
              ) : (
                <option value="">{HOUSEKEEPING_PROOF_HOST_COPY.empty.en}</option>
              )}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-800">
            Stage / Etapa
            <select
              className={fieldClass}
              value={effectiveStage}
              disabled={controlsLocked || noEligibleStays || !selectedStay}
              onChange={(event) => {
                clearHeldLink();
                setStage(event.target.value as HousekeepingProofHostStage);
              }}
            >
              {(selectedStay?.eligibleStages ?? []).length ? (
                (selectedStay?.eligibleStages ?? []).map((value) => (
                  <option key={value} value={value}>
                    {HOUSEKEEPING_PROOF_HOST_COPY.stage[value].en} / {HOUSEKEEPING_PROOF_HOST_COPY.stage[value].es}
                  </option>
                ))
              ) : (
                <option value="">{HOUSEKEEPING_PROOF_HOST_COPY.empty.en}</option>
              )}
            </select>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-sky-700 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!generateEnabled || noEligibleStays}
              onClick={() => void onGenerate()}
            >
              <span>
                {busy ? HOUSEKEEPING_PROOF_HOST_COPY.generating.en : HOUSEKEEPING_PROOF_HOST_COPY.generate.en}
                <span className="mt-0.5 block text-xs font-medium text-sky-100">
                  {busy ? HOUSEKEEPING_PROOF_HOST_COPY.generating.es : HOUSEKEEPING_PROOF_HOST_COPY.generate.es}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!shareEnabled}
              onClick={() => void onShare()}
            >
              <span>
                {sharing ? HOUSEKEEPING_PROOF_HOST_COPY.sharing.en : HOUSEKEEPING_PROOF_HOST_COPY.send.en}
                <span className="mt-0.5 block text-xs font-medium text-slate-500">
                  {sharing ? HOUSEKEEPING_PROOF_HOST_COPY.sharing.es : HOUSEKEEPING_PROOF_HOST_COPY.send.es}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!shareEnabled}
              onClick={() => void copyHeldUrl()}
            >
              <span>
                {HOUSEKEEPING_PROOF_HOST_COPY.copy.en}
                <span className="mt-0.5 block text-xs font-medium text-slate-500">{HOUSEKEEPING_PROOF_HOST_COPY.copy.es}</span>
              </span>
            </button>
          </div>
          {!canIssueLink && reviewable ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2" aria-live="polite">
              <p className="text-sm text-emerald-950">{HOUSEKEEPING_PROOF_HOST_COPY.submissionReceived.en}</p>
              <p className="mt-1 text-sm text-emerald-900">{HOUSEKEEPING_PROOF_HOST_COPY.submissionReceived.es}</p>
            </div>
          ) : null}
          {photoCount > 0 ? (
            <div className="rounded-xl border border-sky-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-900">{HOUSEKEEPING_PROOF_HOST_COPY.photosReceived.en}</p>
              <p className="text-sm text-slate-600">{HOUSEKEEPING_PROOF_HOST_COPY.photosReceived.es}</p>
              <p className="mt-2 text-sm text-slate-800">
                {HOUSEKEEPING_PROOF_HOST_COPY.photosCount.en}: {photoCount} / {HOUSEKEEPING_PROOF_HOST_PHOTO_MAX}
              </p>
              <p className="text-sm text-slate-600">
                {HOUSEKEEPING_PROOF_HOST_COPY.photosCount.es}: {photoCount} / {HOUSEKEEPING_PROOF_HOST_PHOTO_MAX}
              </p>
              {latestReceivedAt ? (
                <>
                  <p className="mt-2 text-sm text-slate-800">
                    {HOUSEKEEPING_PROOF_HOST_COPY.latestReceived.en}: {formatHousekeepingProofReceivedAt(latestReceivedAt)}
                  </p>
                  <p className="text-sm text-slate-600">
                    {HOUSEKEEPING_PROOF_HOST_COPY.latestReceived.es}: {formatHousekeepingProofReceivedAt(latestReceivedAt)}
                  </p>
                </>
              ) : null}
              <button
                type="button"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-sky-700 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                disabled={galleryLoading || reviewing}
                onClick={() => void onReview()}
              >
                <span>
                  {galleryLoading ? HOUSEKEEPING_PROOF_HOST_COPY.reviewing.en : HOUSEKEEPING_PROOF_HOST_COPY.review.en}
                  <span className="mt-0.5 block text-xs font-medium text-sky-100">
                    {galleryLoading ? HOUSEKEEPING_PROOF_HOST_COPY.reviewing.es : HOUSEKEEPING_PROOF_HOST_COPY.review.es}
                  </span>
                </span>
              </button>
              {galleryOpen ? (
                <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{HOUSEKEEPING_PROOF_HOST_COPY.uploadedPhotos.en}</p>
                    <p className="text-sm text-slate-600">{HOUSEKEEPING_PROOF_HOST_COPY.uploadedPhotos.es}</p>
                  </div>
                  {galleryUnavailable ? (
                    <>
                      <p className="text-sm text-slate-800">{HOUSEKEEPING_PROOF_HOST_COPY.reviewUnavailable.en}</p>
                      <p className="text-sm text-slate-600">{HOUSEKEEPING_PROOF_HOST_COPY.reviewUnavailable.es}</p>
                    </>
                  ) : null}
                  <div className={galleryPhotos.length <= 1 ? "grid grid-cols-1" : "grid grid-cols-2 gap-2"}>
                    {galleryPhotos.map((photo) => {
                      const src = housekeepingProofHostPhotoBytesPath(photo.id);
                      if (!src) return null;
                      const expanded = expandedPhotoKey === photo.id;
                      const imageClass =
                        galleryPhotos.length <= 1 || expanded
                          ? "h-auto w-full rounded-lg object-contain max-h-[70vh] sm:max-h-[32rem]"
                          : "h-auto w-full max-h-36 rounded-lg object-contain";
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          className={`min-h-11 rounded-lg bg-slate-100 p-1 ${expanded || galleryPhotos.length <= 1 ? "col-span-full w-full" : ""}`}
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? `${HOUSEKEEPING_PROOF_HOST_COPY.photoAlt.en}: ${HOUSEKEEPING_PROOF_HOST_COPY.closeGallery.en} / ${HOUSEKEEPING_PROOF_HOST_COPY.photoAlt.es}: ${HOUSEKEEPING_PROOF_HOST_COPY.closeGallery.es}`
                              : `${HOUSEKEEPING_PROOF_HOST_COPY.photoAlt.en} / ${HOUSEKEEPING_PROOF_HOST_COPY.photoAlt.es}`
                          }
                          onClick={() => {
                            setExpandedPhotoKey((current) => (current === photo.id ? "" : photo.id));
                          }}
                        >
                          {/* Same-origin authenticated JPEG proxy; next/image is not used so cookies stay first-party. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" className={imageClass} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {reviewActionsVisible ? (
                <div className="mt-5 w-full space-y-4 rounded-xl border-2 border-sky-300 bg-sky-50 p-4 shadow-sm">
                  <div className="w-full border-b border-sky-200 pb-3">
                    <p className="text-base font-bold text-slate-900">{HOUSEKEEPING_PROOF_HOST_COPY.reviewDecision.en}</p>
                    <p className="mt-1 text-sm font-semibold text-sky-900">{HOUSEKEEPING_PROOF_HOST_COPY.reviewDecision.es}</p>
                  </div>
                  {awaitingFinish ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" aria-live="polite">
                      <p className="text-sm text-amber-950">{HOUSEKEEPING_PROOF_HOST_COPY.awaitingFinish.en}</p>
                      <p className="mt-1 text-sm text-amber-900">{HOUSEKEEPING_PROOF_HOST_COPY.awaitingFinish.es}</p>
                    </div>
                  ) : null}
                  {submissionReceived ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2" aria-live="polite">
                      <p className="text-sm text-emerald-950">{HOUSEKEEPING_PROOF_HOST_COPY.submissionReceived.en}</p>
                      <p className="mt-1 text-sm text-emerald-900">{HOUSEKEEPING_PROOF_HOST_COPY.submissionReceived.es}</p>
                    </div>
                  ) : null}
                  <div className="flex w-full flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      className={`${reviewDecisionButtonClass} bg-sky-700 text-white`}
                      disabled={!reviewActionsEnabled}
                      onClick={() => void onDecide("approve")}
                    >
                      <span>
                        {reviewing && reviewDecision === "approve"
                          ? HOUSEKEEPING_PROOF_HOST_COPY.approving.en
                          : HOUSEKEEPING_PROOF_HOST_COPY.approve.en}
                        <span className="mt-0.5 block text-xs font-medium text-sky-100">
                          {reviewing && reviewDecision === "approve"
                            ? HOUSEKEEPING_PROOF_HOST_COPY.approving.es
                            : HOUSEKEEPING_PROOF_HOST_COPY.approve.es}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`${reviewDecisionButtonClass} border border-slate-300 bg-white text-slate-900`}
                      disabled={!reviewActionsEnabled}
                      onClick={() => void onDecide("needs_attention")}
                    >
                      <span>
                        {reviewing && reviewDecision === "needs_attention"
                          ? HOUSEKEEPING_PROOF_HOST_COPY.savingReview.en
                          : HOUSEKEEPING_PROOF_HOST_COPY.needsAttention.en}
                        <span className="mt-0.5 block text-xs font-medium text-slate-500">
                          {reviewing && reviewDecision === "needs_attention"
                            ? HOUSEKEEPING_PROOF_HOST_COPY.savingReview.es
                            : HOUSEKEEPING_PROOF_HOST_COPY.needsAttention.es}
                        </span>
                      </span>
                    </button>
                  </div>
                </div>
              ) : null}
              {galleryOpen ? (
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900"
                  onClick={() => {
                    galleryAbort.current?.abort();
                    galleryGen.current += 1;
                    setGalleryOpen(false);
                    setGalleryPhotos([]);
                    setGalleryUnavailable(false);
                    setGalleryLoading(false);
                    setExpandedPhotoKey("");
                  }}
                >
                  <span>
                    {HOUSEKEEPING_PROOF_HOST_COPY.closeGallery.en}
                    <span className="mt-0.5 block text-xs font-medium text-slate-500">
                      {HOUSEKEEPING_PROOF_HOST_COPY.closeGallery.es}
                    </span>
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
          {photoStatusUnavailable ? (
            <div>
              <p className="text-sm text-slate-800">{HOUSEKEEPING_PROOF_HOST_COPY.reviewUnavailable.en}</p>
              <p className="mt-1 text-sm text-slate-600">{HOUSEKEEPING_PROOF_HOST_COPY.reviewUnavailable.es}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {statusCopy ? (
        <div className="mt-3" aria-live="polite">
          <p className="text-sm text-slate-800">{statusCopy.en}</p>
          <p className="mt-1 text-sm text-slate-600">{statusCopy.es}</p>
        </div>
      ) : null}
    </section>
  );
}
