"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toPng } from "html-to-image";
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

const DEFAULT_BASE_URL = "https://neutral-hart-isbn-function.trycloudflare.com";
const DEFAULT_AI_PHONE = "+1 (305) 555-0199";

function defaultGuestUrl(propertyId?: string) {
  const id = propertyId || "prop-1";
  const base = (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  return `${base}/guest/${id}`;
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
  const qrArtRef = useRef<HTMLDivElement>(null);
  const qrPrintRef = useRef<HTMLDivElement>(null);

  const propertyName = property.name;
  const propertyAddress = `${property.address}, ${property.city}, FL`;
  const hostLine = hostPhone || emergencyNumber;
  const wifiSsid = property.wifiNetwork;
  const wifiPass = property.wifiPassword;
  const checkIn = property.checkIn;
  const checkOut = property.checkOut;

  useEffect(() => {
    setGuestUrl(defaultGuestUrl(property.id));
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

  const handleDownloadPng = async () => {
    const node = qrPrintRef.current ?? qrArtRef.current;
    if (!node) return;
    try {
      const dataUrl = await toPng(node, { pixelRatio: 4, backgroundColor: "#ffffff", cacheBust: true });
      const link = document.createElement("a");
      link.href = dataUrl;
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
      `}</style>

      <div className="print-hidden flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
        <span className="text-xs font-medium text-zinc-300">Welcome Sign & AI Portal</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadPng()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition"
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

      <div className="print-guest-card p-6 bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-2xl shadow-xl print:border-none print:shadow-none print:p-2 print:text-black print:bg-white">
        <div className="text-center mb-5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-400 print:text-emerald-700">
            Guest Smart Concierge
          </span>
          <h2 className="text-xl font-bold mt-1 text-white print:text-black">{propertyName}</h2>
          <p className="text-xs text-zinc-400 print:text-zinc-600">{propertyAddress}</p>
        </div>

        <div className="flex flex-col items-center p-5 bg-zinc-900/70 border border-zinc-800 rounded-xl mb-5 text-center print:bg-zinc-50 print:border-zinc-300">
          <div ref={qrArtRef} className="p-2.5 bg-white rounded-xl shadow-md mb-2">
            <QRCodeSVG id="guest-qr-svg" key={guestUrl} value={guestUrl} size={160} level="M" title={guestUrl} includeMargin />
          </div>
          <div
            ref={qrPrintRef}
            className="pointer-events-none fixed -left-[9999px] top-0 bg-white p-6"
            aria-hidden
          >
            <QRCodeSVG key={`print-${guestUrl}`} value={guestUrl} size={640} level="H" includeMargin />
          </div>
          <p className="text-xs font-semibold text-zinc-200 print:text-zinc-800">
            Scan to talk with Elena or open the guest portal
          </p>
          <label className="print-hidden mt-3 w-full max-w-sm text-left">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Guest portal URL (encoded in QR)
            </span>
            <input
              type="url"
              value={guestUrl}
              onChange={(event) => setGuestUrl(event.target.value)}
              onBlur={() => {
                if (!guestUrl.trim()) setGuestUrl(defaultGuestUrl(propId));
              }}
              className="w-full break-all rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-200 focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <p className="mt-2 hidden w-full max-w-sm break-all font-mono text-[11px] text-zinc-600 print:block">
            {guestUrl}
          </p>
          <div className="print-hidden mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[11px] font-semibold text-zinc-100 hover:bg-zinc-700"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy URL"}
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPng()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
            >
              <Download className="h-3.5 w-3.5" />
              Download QR (PNG)
            </button>
            <button
              type="button"
              onClick={handleDownloadSvg}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              Download SVG
            </button>
            <a
              href={guestUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
            >
              Open Link <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="space-y-2 mb-5">
          <span className="text-[10px] font-bold tracking-wider uppercase text-zinc-400 print:text-zinc-600">
            Assistance & Contact
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <a
              href={telHref(aiPhone)}
              className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center gap-2.5 print:border-zinc-300 print:bg-zinc-50"
            >
              <Phone className="w-4 h-4 text-emerald-400 print:text-emerald-700 shrink-0" />
              <div>
                <p className="font-semibold text-white print:text-black">Elena AI 24/7</p>
                <p className="text-[11px] text-zinc-400 print:text-zinc-600">{aiPhone}</p>
              </div>
            </a>
            <a
              href={telHref(hostLine)}
              className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center gap-2.5 print:border-zinc-300 print:bg-zinc-50"
            >
              <Phone className="w-4 h-4 text-blue-400 print:text-blue-700 shrink-0" />
              <div>
                <p className="font-semibold text-white print:text-black">Host / co-host</p>
                <p className="text-[11px] text-zinc-400 print:text-zinc-600">{hostLine}</p>
              </div>
            </a>
          </div>

          <a
            href="tel:911"
            className="p-3 bg-rose-950/30 border border-rose-900/40 rounded-xl flex items-center gap-2.5 text-xs print:border-rose-300 print:bg-rose-50"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400 print:text-rose-700 shrink-0" />
            <div>
              <p className="font-semibold text-rose-300 print:text-rose-900">Emergencias: 911</p>
              <p className="text-[10px] text-zinc-400 print:text-zinc-600">
                Address: {propertyAddress}
              </p>
              {emergencyNumber !== "911" ? (
                <p className="text-[10px] text-zinc-500">Host emergency: {emergencyNumber}</p>
              ) : null}
            </div>
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-zinc-800 text-xs print:border-zinc-300">
          <div className="flex items-start gap-2">
            <Wifi className="w-4 h-4 text-zinc-400 print:text-zinc-600 mt-0.5" />
            <div>
              <p className="text-[10px] text-zinc-400 print:text-zinc-500">Wi-Fi:</p>
              <p className="font-bold text-white print:text-black">{wifiSsid}</p>
              <p className="text-[10px] text-zinc-400 print:text-zinc-500 mt-1">Password:</p>
              <p className="font-mono text-emerald-400 print:text-emerald-800 font-semibold">{wifiPass}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-zinc-400 print:text-zinc-600 mt-0.5" />
            <div>
              <p className="text-[10px] text-zinc-400 print:text-zinc-500">Check-in / Out:</p>
              <p className="font-semibold text-white print:text-black">
                {checkIn} – {checkOut}
              </p>
              <p className="mt-1 text-[10px] text-zinc-400 print:text-zinc-500">Door:</p>
              <p className="font-semibold text-white print:text-black">{property.doorCode}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
