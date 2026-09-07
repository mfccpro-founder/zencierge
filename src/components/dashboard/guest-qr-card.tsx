"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Check, Clock, Copy, Download, ExternalLink, Printer, Share2, ShieldAlert } from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import {
  HOST_QR_COPY,
  buildSecureGuestUrl,
  canStartGuestShare,
  canStartStayLinkGenerate,
  executeHostGuestShare,
  parseHostQrStaysResponse,
  shouldConfirmStayLinkReplace,
  stayLinkRequestBody,
  stayLinksEligiblePath,
  type HostGuestSharePayload,
  type HostQrStay,
} from "@/lib/guest-stay-qr";
import { isHttpsOrigin, publicApiUrl, resolveReachableAppOrigin } from "@/lib/public-app-url";

const QR_FG_COLOR = "#1E293B";
const QR_BG_COLOR = "#FFFFFF";

type StayLoadState = "loading" | "ready" | "empty" | "unauthorized" | "unavailable";

export function GuestQrCard({ property }: { property: Property }) {
  const [boundPropertyId, setBoundPropertyId] = useState(property.id);
  const [stays, setStays] = useState<HostQrStay[]>([]);
  const [loadState, setLoadState] = useState<StayLoadState>("loading");
  const [reservationId, setReservationId] = useState("");
  const [path, setPath] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState("");
  const [shareHint, setShareHint] = useState("");
  const [tunnelHint, setTunnelHint] = useState<string | null>(null);
  const generatingRef = useRef(false);
  const sharingRef = useRef(false);
  const fetchGenerationRef = useRef(0);
  const qrPrintCanvasRef = useRef<HTMLCanvasElement>(null);

  if (property.id !== boundPropertyId) {
    setBoundPropertyId(property.id);
    setReservationId("");
    setPath("");
    setStatus("");
    setShareHint("");
    setStays([]);
    setLoadState("loading");
  }

  useEffect(() => {
    const generation = fetchGenerationRef.current + 1;
    fetchGenerationRef.current = generation;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(publicApiUrl(stayLinksEligiblePath(property.id)), {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (generation !== fetchGenerationRef.current) return;
        if (response.status === 401) {
          setStays([]);
          setLoadState("unauthorized");
          return;
        }
        if (!response.ok) {
          setStays([]);
          setLoadState("unavailable");
          return;
        }
        const payload: unknown = await response.json();
        if (generation !== fetchGenerationRef.current) return;
        const parsed = parseHostQrStaysResponse(payload);
        if (!parsed) {
          setStays([]);
          setLoadState("unavailable");
          return;
        }
        setStays(parsed);
        setLoadState(parsed.length ? "ready" : "empty");
      } catch (cause) {
        if (controller.signal.aborted || generation !== fetchGenerationRef.current) return;
        void cause;
        setStays([]);
        setLoadState("unavailable");
      }
    })();
    return () => {
      controller.abort();
    };
  }, [property.id]);

  const selectedId = stays.some((row) => row.id === reservationId) ? reservationId : stays[0]?.id ?? "";
  const selected = stays.find((row) => row.id === selectedId) ?? null;
  const loadHint =
    loadState === "loading"
      ? HOST_QR_COPY.loadingStays
      : loadState === "unauthorized"
        ? HOST_QR_COPY.unauthorized
        : loadState === "unavailable"
          ? HOST_QR_COPY.unavailable
          : "";
  const guestUrl = path ? buildSecureGuestUrl(origin, path) : "";

  useEffect(() => {
    let cancelled = false;
    const refreshOrigin = async () => {
      try {
        const next = await resolveReachableAppOrigin();
        if (!cancelled) setOrigin(next);
      } catch {
        if (!cancelled) setOrigin("");
      }
      try {
        const response = await fetch("/api/dev-tunnel", { cache: "no-store" });
        const data = (await response.json()) as { origin?: string | null; running?: boolean };
        if (!cancelled) setTunnelHint(data.running && data.origin ? data.origin : null);
      } catch {
        if (!cancelled) setTunnelHint(null);
      }
    };
    void refreshOrigin();
    const timer = window.setInterval(() => void refreshOrigin(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const generate = async () => {
    if (!canStartStayLinkGenerate(busy || generatingRef.current || loadState !== "ready", selectedId || null)) {
      setStatus(HOST_QR_COPY.pickStay);
      return;
    }
    if (shouldConfirmStayLinkReplace(Boolean(path)) && !window.confirm(HOST_QR_COPY.replaceWarning)) return;
    generatingRef.current = true;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(publicApiUrl("/api/guest/stay-links"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(stayLinkRequestBody(selectedId)),
      });
      const payload = (await response.json()) as { error?: string; path?: string };
      if (!response.ok || typeof payload.path !== "string") {
        setStatus("Could not generate a secure guest link.");
        return;
      }
      const nextOrigin = await resolveReachableAppOrigin();
      setOrigin(nextOrigin);
      setPath(payload.path);
    } catch {
      setStatus("Could not generate a secure guest link.");
    } finally {
      generatingRef.current = false;
      setBusy(false);
    }
  };

  const handlePrint = () => window.print();

  const handleCopy = async () => {
    if (!guestUrl) return;
    try {
      await navigator.clipboard.writeText(guestUrl);
    } catch {
      window.prompt("Copy guest link", guestUrl);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!canStartGuestShare(guestUrl, sharingRef.current)) return;
    sharingRef.current = true;
    setSharing(true);
    setShareHint("");
    try {
      const nativeShare =
        typeof navigator !== "undefined" && typeof navigator.share === "function"
          ? (data: HostGuestSharePayload) => navigator.share(data)
          : undefined;
      const outcome = await executeHostGuestShare(guestUrl, false, {
        share: nativeShare,
        copy: handleCopy,
      });
      if (outcome === "copied") setShareHint(HOST_QR_COPY.copiedShareFallback);
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  };

  const shareDisabled = !canStartGuestShare(guestUrl, sharing);
  const sendButtonClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

  const handleDownloadPng = () => {
    const canvas = qrPrintCanvasRef.current;
    if (!canvas || !guestUrl) return;
    try {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "elena-guest-qr.png";
      link.click();
    } catch {
      handleDownloadSvg();
    }
  };

  const handleDownloadSvg = () => {
    const svg = document.getElementById("guest-qr-svg");
    if (!(svg instanceof SVGSVGElement) || !guestUrl) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "elena-guest-qr.svg";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  return (
    <div className="mx-auto my-6 flex w-full max-w-xl flex-col gap-4 font-sans">
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.45in; }
          body * { visibility: hidden !important; }
          .print-guest-card, .print-guest-card * { visibility: visible !important; }
          .print-guest-card {
            position: absolute !important;
            inset: 0 !important;
            box-shadow: none !important;
          }
          .print-hidden { display: none !important; }
        }
        .guest-qr-mark svg path:nth-of-type(1) { fill: #FFFFFF !important; }
        .guest-qr-mark svg path:nth-of-type(2) { fill: #1E293B !important; }
      `}</style>

      <div className="print-hidden flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <span className="text-xs font-medium text-slate-700">Secure guest QR</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!guestUrl}
            onClick={() => void handleCopy()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            type="button"
            disabled={shareDisabled}
            onClick={() => void handleShare()}
            className={sendButtonClass}
          >
            <Share2 className="h-3.5 w-3.5" />
            {sharing ? HOST_QR_COPY.sending : HOST_QR_COPY.sendToGuest}
          </button>
          <button
            type="button"
            disabled={!guestUrl}
            onClick={handleDownloadPng}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Download QR (PNG)
          </button>
          <button
            type="button"
            disabled={!guestUrl}
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </button>
        </div>
      </div>

      <div className="print-hidden rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-950">
        {HOST_QR_COPY.replaceWarning}
      </div>

      <div className="print-hidden space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {HOST_QR_COPY.pickStay}
        </label>
        <select
          value={selectedId}
          disabled={loadState === "loading" || stays.length === 0}
          onChange={(event) => {
            setReservationId(event.target.value);
            setPath("");
            setStatus("");
            setShareHint("");
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
        >
          {stays.length === 0 ? <option value="">{HOST_QR_COPY.emptyStays}</option> : null}
          {stays.map((row) => (
            <option key={row.id} value={row.id}>
              {row.checkIn} → {row.checkOut} · {row.status}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!canStartStayLinkGenerate(busy || loadState !== "ready", selectedId || null)}
          onClick={() => void generate()}
          className="w-full rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {busy ? HOST_QR_COPY.generating : HOST_QR_COPY.generate}
        </button>
        {loadHint ? <p className="text-[11px] text-slate-600">{loadHint}</p> : null}
        {shareHint ? <p className="text-[11px] text-emerald-800">{shareHint}</p> : null}
        {status ? <p className="text-[11px] text-rose-700">{status}</p> : null}
      </div>

      <div className="print-guest-card rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm print:border-none print:bg-white print:p-2 print:text-black print:shadow-none">
        <div className="mb-5 text-center">
          <span className="text-[10px] font-bold uppercase tracking-widest text-sky-700 print:text-emerald-700">
            Guest Smart Concierge
          </span>
          <h2 className="mt-1 text-xl font-bold text-slate-900 print:text-black">{property.name}</h2>
          <p className="text-xs text-slate-600 print:text-zinc-600">{property.city}</p>
        </div>

        <div className="mb-5 flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50 p-5 text-center print:border-zinc-300 print:bg-zinc-50">
          {guestUrl ? (
            <>
              <div className="guest-qr-mark mb-2 rounded-xl bg-white p-2.5 shadow-md">
                <QRCodeCanvas
                  key={`canvas-${guestUrl}`}
                  value={guestUrl}
                  size={160}
                  level="M"
                  marginSize={2}
                  fgColor={QR_FG_COLOR}
                  bgColor={QR_BG_COLOR}
                  title="Secure guest portal"
                />
                <QRCodeSVG
                  id="guest-qr-svg"
                  className="hidden"
                  key={`svg-${guestUrl}`}
                  value={guestUrl}
                  size={160}
                  level="M"
                  marginSize={2}
                  title="Secure guest portal"
                  fgColor={QR_FG_COLOR}
                  bgColor={QR_BG_COLOR}
                />
              </div>
              <QRCodeCanvas
                ref={qrPrintCanvasRef}
                key={`print-${guestUrl}`}
                className="pointer-events-none fixed -left-[9999px] top-0"
                value={guestUrl}
                size={640}
                level="H"
                marginSize={4}
                fgColor={QR_FG_COLOR}
                bgColor={QR_BG_COLOR}
                aria-hidden
              />
            </>
          ) : (
            <p className="print-hidden text-xs text-slate-500">Generate a secure QR to encode the guest link.</p>
          )}
          <p className="text-xs font-semibold text-slate-800 print:text-zinc-800">{HOST_QR_COPY.scan}</p>
          <p className="mt-1 text-[11px] text-slate-600 print:text-zinc-600">{HOST_QR_COPY.expires}</p>
          <div className="print-hidden mt-3 w-full max-w-sm rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-left text-[11px] leading-relaxed text-sky-950">
            <p className="font-bold">Phone scan (HTTPS)</p>
            {tunnelHint ? (
              <p className="mt-1">Tunnel is live. Refresh and generate after the HTTPS origin appears, then scan on the phone.</p>
            ) : (
              <p className="mt-1">
                Keep <span className="font-mono">npm run dev</span> running. For phone scans also run{" "}
                <span className="font-mono">npm run tunnel</span>, then generate the QR.
              </p>
            )}
            {guestUrl ? (
              <p className="mt-1 break-all font-mono text-[10px] text-sky-900">{isHttpsOrigin(guestUrl) ? "HTTPS guest link" : "Local or relative guest link"}</p>
            ) : null}
          </div>
          {guestUrl ? (
            <p className="mt-2 hidden w-full max-w-sm break-all font-mono text-[11px] text-zinc-600 print:block">{guestUrl}</p>
          ) : null}
          <div className="print-hidden mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={!guestUrl}
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy URL"}
            </button>
            <button
              type="button"
              disabled={shareDisabled}
              onClick={() => void handleShare()}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Share2 className="h-3.5 w-3.5" />
              {sharing ? HOST_QR_COPY.sending : HOST_QR_COPY.sendToGuest}
            </button>
            <button
              type="button"
              disabled={!guestUrl}
              onClick={handleDownloadPng}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Download QR (PNG)
            </button>
            <button
              type="button"
              disabled={!guestUrl}
              onClick={handleDownloadSvg}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Download SVG
            </button>
            {guestUrl ? (
              <a href={guestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-800 hover:underline">
                Open Link <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="mb-4 flex items-start gap-2 text-xs">
          <Clock className="mt-0.5 h-4 w-4 text-slate-500 print:text-zinc-600" />
          <div>
            <p className="text-[10px] text-slate-500 print:text-zinc-500">Check-in / Checkout</p>
            <p className="font-semibold text-slate-900 print:text-black">
              {selected ? `${selected.checkIn} – ${selected.checkOut}` : "Select a reservation"}
            </p>
          </div>
        </div>

        <a href="tel:911" className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs print:border-rose-300 print:bg-rose-50">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 print:text-rose-700" />
          <div>
            <p className="font-semibold text-rose-800 print:text-rose-900">Emergency: 911</p>
            <p className="text-[10px] text-slate-600 print:text-zinc-600">{HOST_QR_COPY.emergency}</p>
          </div>
        </a>
      </div>
    </div>
  );
}
