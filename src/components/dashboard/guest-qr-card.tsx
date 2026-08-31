"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import {
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Phone,
  Printer,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import { guestPortalUrl, guestPortalUrlAsync, isHttpsOrigin } from "@/lib/public-app-url";

const DEFAULT_AI_PHONE = "+1 (305) 555-0199";
/** Forced brand ink — slate-800. Do not inherit CSS currentColor. */
const QR_FG_COLOR = "#1E293B";
const QR_BG_COLOR = "#FFFFFF";

function defaultGuestUrl(propertyId?: string) {
  return guestPortalUrl(propertyId);
}

export function GuestQrCard({
  property,
  aiPhone = DEFAULT_AI_PHONE,
  emergencyNumber = "911",
  hostPhone,
}: {
  property: Property;
  aiPhone?: string;
  emergencyNumber?: string;
  hostPhone?: string;
}) {
  const propId = property.id || "prop-1";
  const [guestUrl, setGuestUrl] = useState(() => defaultGuestUrl(property.id));
  const [copied, setCopied] = useState(false);
  const [tunnelHint, setTunnelHint] = useState<string | null>(null);
  const qrArtRef = useRef<HTMLDivElement>(null);
  const qrPrintCanvasRef = useRef<HTMLCanvasElement>(null);

  const propertyName = property.name;
  const propertyAddress = `${property.address}, ${property.city}, FL`;
  const hostLine = hostPhone || emergencyNumber;
  const wifiSsid = property.wifiNetwork;
  const wifiPass = property.wifiPassword;
  const checkIn = property.checkIn;
  const checkOut = property.checkOut;

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const url = await guestPortalUrlAsync(property.id);
      if (!cancelled) setGuestUrl(url);
      try {
        const response = await fetch("/api/dev-tunnel", { cache: "no-store" });
        const data = (await response.json()) as { origin?: string | null; running?: boolean };
        if (!cancelled) {
          setTunnelHint(data.running && data.origin ? data.origin : null);
        }
      } catch {
        if (!cancelled) setTunnelHint(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [property.id]);

  const handlePrint = () => window.print();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(guestUrl);
    } catch {
      window.prompt("Copy guest link", guestUrl);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPng = () => {
    const canvas = qrPrintCanvasRef.current;
    if (!canvas) return;
    try {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `elena-guest-qr-${propId}.png`;
      link.click();
    } catch (cause) {
      console.error("[qr] PNG download failed", cause);
      handleDownloadSvg();
    }
  };

  const handleDownloadSvg = () => {
    const svg = document.getElementById("guest-qr-svg");
    if (!(svg instanceof SVGSVGElement)) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `elena-guest-qr-${propId}.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const telHref = (value: string) => `tel:${value.replace(/[^\d+]/g, "")}`;

  return (
    <div className="w-full max-w-xl mx-auto my-6 flex flex-col gap-4 font-sans">
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

      <div className="print-hidden flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
        <span className="text-xs font-medium text-slate-700">Welcome Sign & AI Portal</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 transition hover:bg-slate-100"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            aria-label="Download QR (PNG)"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 transition hover:bg-slate-100"
          >
            <Download className="w-3.5 h-3.5" />
            Download QR (PNG)
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      <div className="print-guest-card rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm print:border-none print:p-2 print:text-black print:shadow-none print:bg-white">
        <div className="mb-5 text-center">
          <span className="text-[10px] font-bold uppercase tracking-widest text-sky-700 print:text-emerald-700">
            Guest Smart Concierge
          </span>
          <h2 className="mt-1 text-xl font-bold text-slate-900 print:text-black">{propertyName}</h2>
          <p className="text-xs text-slate-600 print:text-zinc-600">{propertyAddress}</p>
        </div>

        <div className="mb-5 flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50 p-5 text-center print:border-zinc-300 print:bg-zinc-50">
          <div ref={qrArtRef} className="guest-qr-mark mb-2 rounded-xl bg-white p-2.5 shadow-md">
            <QRCodeCanvas
              key={`canvas-${guestUrl}-${QR_FG_COLOR}`}
              value={guestUrl}
              size={160}
              level="M"
              marginSize={2}
              fgColor={QR_FG_COLOR}
              bgColor={QR_BG_COLOR}
              title={guestUrl}
            />
            <QRCodeSVG
              id="guest-qr-svg"
              className="hidden"
              key={`svg-${guestUrl}-${QR_FG_COLOR}`}
              value={guestUrl}
              size={160}
              level="M"
              marginSize={2}
              title={guestUrl}
              fgColor={QR_FG_COLOR}
              bgColor={QR_BG_COLOR}
            />
          </div>
          <QRCodeCanvas
            ref={qrPrintCanvasRef}
            key={`print-${guestUrl}-${QR_FG_COLOR}`}
            className="pointer-events-none fixed -left-[9999px] top-0"
            value={guestUrl}
            size={640}
            level="H"
            marginSize={4}
            fgColor={QR_FG_COLOR}
            bgColor={QR_BG_COLOR}
            aria-hidden
          />
          <p className="text-xs font-semibold text-slate-800 print:text-zinc-800">
            Scan to talk with Elena or open the guest portal
          </p>
          <div className="print-hidden mt-3 w-full max-w-sm rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-left text-[11px] leading-relaxed text-sky-950">
            <p className="font-bold">Phone Tap to talk (HTTPS tunnel)</p>
            {tunnelHint ? (
              <p className="mt-1">
                Tunnel is live. This QR should use <span className="break-all font-mono">{tunnelHint}</span>. Scan on
                the phone — do not use https:// on your LAN IP.
              </p>
            ) : (
              <p className="mt-1">
                Keep <span className="font-mono">npm run dev</span> running. In a second terminal run{" "}
                <span className="font-mono">npm run tunnel</span>, wait for an https://…trycloudflare.com URL, then
                refresh this card and scan. Local HTTP still works for typing.
              </p>
            )}
          </div>
          <label className="print-hidden mt-3 w-full max-w-sm text-left">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Guest portal URL (encoded in QR)
            </span>
            <input
              type="url"
              value={guestUrl}
              onChange={(event) => setGuestUrl(event.target.value)}
              onBlur={() => {
                if (!guestUrl.trim()) {
                  void guestPortalUrlAsync(propId).then(setGuestUrl);
                }
              }}
              className="w-full break-all rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-900 focus:border-sky-600 focus:outline-none"
            />
            {isHttpsOrigin(guestUrl) ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-emerald-800">
                HTTPS guest link — phones can use Tap to talk after scan.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] leading-relaxed text-amber-800">
                Local HTTP link. Fine for typing on the LAN. For real microphone testing run npm run tunnel and scan
                the HTTPS QR.
              </p>
            )}
          </label>
          <p className="mt-2 hidden w-full max-w-sm break-all font-mono text-[11px] text-zinc-600 print:block">
            {guestUrl}
          </p>
          <div className="print-hidden mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy URL"}
            </button>
            <button
              type="button"
              onClick={handleDownloadPng}
              aria-label="Download QR (PNG)"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
            >
              <Download className="h-3.5 w-3.5" />
              Download QR (PNG)
            </button>
            <button
              type="button"
              onClick={handleDownloadSvg}
              aria-label="Download SVG"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50"
            >
              Download SVG
            </button>
            <a
              href={guestUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-sky-800 hover:underline"
            >
              Open Link <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="space-y-2 mb-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 print:text-zinc-600">
            Assistance & Contact
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <a
              href={telHref(aiPhone)}
              className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 print:border-zinc-300 print:bg-zinc-50"
            >
              <Phone className="w-4 h-4 text-emerald-400 print:text-emerald-700 shrink-0" />
              <div>
                <p className="font-semibold text-slate-900 print:text-black">Elena AI 24/7</p>
                <p className="text-[11px] text-slate-600 print:text-zinc-600">{aiPhone}</p>
              </div>
            </a>
            <a
              href={telHref(hostLine)}
              className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 print:border-zinc-300 print:bg-zinc-50"
            >
              <Phone className="w-4 h-4 text-blue-400 print:text-blue-700 shrink-0" />
              <div>
                <p className="font-semibold text-slate-900 print:text-black">Host / co-host</p>
                <p className="text-[11px] text-slate-600 print:text-zinc-600">{hostLine}</p>
              </div>
            </a>
          </div>

          <a
            href="tel:911"
            className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs print:border-rose-300 print:bg-rose-50"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400 print:text-rose-700 shrink-0" />
            <div>
              <p className="font-semibold text-rose-800 print:text-rose-900">Emergency: 911</p>
              <p className="text-[10px] text-slate-600 print:text-zinc-600">
                Address: {propertyAddress}
              </p>
              {emergencyNumber !== "911" ? (
                <p className="text-[10px] text-slate-500">Host emergency: {emergencyNumber}</p>
              ) : null}
            </div>
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3 text-xs print:border-zinc-300">
          <div className="flex items-start gap-2">
            <Wifi className="mt-0.5 h-4 w-4 text-slate-500 print:text-zinc-600" />
            <div>
              <p className="text-[10px] text-slate-500 print:text-zinc-500">Wi-Fi:</p>
              <p className="font-bold text-slate-900 print:text-black">{wifiSsid}</p>
              <p className="mt-1 text-[10px] text-slate-500 print:text-zinc-500">Password:</p>
              <p className="font-mono font-semibold text-sky-800 print:text-emerald-800">{wifiPass}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 text-slate-500 print:text-zinc-600" />
            <div>
              <p className="text-[10px] text-slate-500 print:text-zinc-500">Check-in / Out:</p>
              <p className="font-semibold text-slate-900 print:text-black">
                {checkIn} – {checkOut}
              </p>
              <p className="mt-1 text-[10px] text-slate-500 print:text-zinc-500">Door:</p>
              <p className="font-semibold text-slate-900 print:text-black">{property.doorCode}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
