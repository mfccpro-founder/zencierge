"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2, Printer } from "lucide-react";
import {
  consumeHousekeepingPhotoQueue,
  formatPhotoEvidenceLine,
  type HousekeepingDisputePhoto,
} from "@/lib/dispute-photo-transfer";

type GuestOption = { id: string; fullName: string; email: string; phone: string; propertyId: string };

type IncidentForm = {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  propertyId: string;
  listingUrl: string;
  reservationCode: string;
  aircoverClaimId: string;
  incidentDate: string;
  incidentTime: string;
  category: string;
  description: string;
  actionsTaken: string;
  damagesUsd: string;
  witnesses: string;
  evidenceNotes: string;
};

const EMPTY_FORM: IncidentForm = {
  guestName: "",
  guestEmail: "",
  guestPhone: "",
  propertyId: "",
  listingUrl: "",
  reservationCode: "",
  aircoverClaimId: "",
  incidentDate: new Date().toISOString().slice(0, 10),
  incidentTime: "",
  category: "House rules violation (noise / occupancy)",
  description: "",
  actionsTaken: "",
  damagesUsd: "0",
  witnesses: "",
  evidenceNotes: "",
};

const CATEGORIES = [
  "House rules violation (noise / occupancy)",
  "Unauthorized party or event",
  "Property damage",
  "False damage / AirCover abuse",
  "Unauthorized extra guests",
  "Smoking indoors",
  "Safety or security concern",
  "Threat or harassment",
];

function exhibitId(form: IncidentForm) {
  const raw = `${form.propertyId}|${form.reservationCode}|${form.incidentDate}|${form.incidentTime}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  return `ZC-EXH-${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

function buildReport(form: IncidentForm) {
  const generated = new Date().toISOString();
  const exhibit = exhibitId(form);
  return [
    "ZENCIERGE FORENSIC DISPUTE DOSSIER",
    "Prepared for Airbnb AirCover / OTA Trust & Safety",
    "=".repeat(72),
    `Exhibit ID: ${exhibit}`,
    `Generated (UTC): ${generated}`,
    "Custody: Host-of-record → Zencierge admin console → OTA resolution upload",
    "Integrity: This exhibit is a contemporaneous compilation of platform logs, guest identity, and host notes. Do not alter after export.",
    "",
    "A. LISTING & RESERVATION",
    `- Property ID: ${form.propertyId || "—"}`,
    `- Listing URL: ${form.listingUrl || "—"}`,
    `- Reservation / confirmation code: ${form.reservationCode || "—"}`,
    `- AirCover / OTA claim ID: ${form.aircoverClaimId || "pending"}`,
    "",
    "B. GUEST OF RECORD (IDENTITY LOCK)",
    `- Legal name as captured at check-in: ${form.guestName || "—"}`,
    `- Email: ${form.guestEmail || "—"}`,
    `- Phone: ${form.guestPhone || "—"}`,
    "",
    "C. INCIDENT TIMELINE",
    `- Local date: ${form.incidentDate || "—"}`,
    `- Local time: ${form.incidentTime || "—"}`,
    `- Category: ${form.category}`,
    "",
    "Narrative (neutral, first-person host observations):",
    form.description || "—",
    "",
    "D. HOST MITIGATION (AIRCOVER DUTY TO MITIGATE)",
    form.actionsTaken || "—",
    "",
    "E. QUANTIFIED LOSS",
    `- Amount claimed (USD): $${form.damagesUsd || "0"}`,
    "",
    "F. THIRD-PARTY CORROBORATION",
    form.witnesses || "—",
    "",
    "G. DIGITAL EVIDENCE INDEX",
    form.evidenceNotes || "—",
    "",
    "H. REQUESTED OTA ACTION",
    "- Uphold house rules / listing standards.",
    "- Deny guest-initiated false-damage or chargeback-style dispute where evidence contradicts the claim.",
    "- Apply AirCover (or equivalent OTA host protection) for documented loss.",
    "",
    "-".repeat(72),
    "Certification: I am the host or authorized operator. Facts above are true to the best of my knowledge and were assembled from Zencierge check-in, NeighborShield, and host records for this reservation.",
  ].join("\n");
}

export function DisputeDossierPanel() {
  const [form, setForm] = useState<IncidentForm>(EMPTY_FORM);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(true);
  const [incomingPhotos, setIncomingPhotos] = useState<HousekeepingDisputePhoto[]>([]);

  useEffect(() => {
    const queued = consumeHousekeepingPhotoQueue();
    if (queued.length === 0) return;
    setIncomingPhotos(queued);
    setForm((prev) => {
      const first = queued[0];
      if (!first) return prev;
      const lines = queued.map(formatPhotoEvidenceLine);
      const evidenceNotes = [prev.evidenceNotes, ...lines].filter(Boolean).join("\n");
      return {
        ...prev,
        propertyId: prev.propertyId || first.propertyId,
        category: "Property damage",
        evidenceNotes,
        description:
          prev.description ||
          `Housekeeping pre-cleaning photo transferred from ${first.property} (unit ${first.unit}).`,
      };
    });
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/guest-dna")
      .then((res) => res.json() as Promise<{ guests?: GuestOption[] }>)
      .then((data) => {
        if (active) setGuests(data.guests ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingGuests(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const report = useMemo(() => buildReport(form), [form]);
  const set =
    (key: keyof IncidentForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const downloadTxt = () => {
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aircover-forensic-${(form.guestName || "guest").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${form.incidentDate}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    const win = window.open("", "_blank", "width=820,height=1000");
    if (!win) return;
    const escaped = report.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);
    win.document.write(
      `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;padding:32px;">${escaped}</pre>`,
    );
    win.document.close();
    win.focus();
    win.print();
  };

  const field =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none";
  const label = "text-sm font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Forensic exhibit builder</h2>
        <p className="mt-2 text-base text-slate-600">
          Assemble a chain-of-custody pack for AirCover or OTA Trust &amp; Safety. Prefill identity from Guest DNA, then export
          TXT or print to PDF.
        </p>

        {incomingPhotos.length > 0 ? (
          <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <p className="text-sm font-bold text-slate-900">Housekeeping photos added to this claim</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {incomingPhotos.map((photo) => (
                <figure key={photo.photoId} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.caption} className="h-24 w-full object-cover" />
                  <figcaption className="p-2 text-[11px] font-semibold text-slate-900">{photo.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ) : null}

        {loadingGuests ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading captured guests…
          </p>
        ) : guests.length > 0 ? (
          <div className="mt-5">
            <label className={label}>Prefill from captured guest</label>
            <select
              className={field + " mt-2 sm:max-w-md"}
              value=""
              onChange={(event) => {
                const guest = guests.find((row) => row.id === event.target.value);
                if (!guest) return;
                setForm((prev) => ({
                  ...prev,
                  guestName: guest.fullName === "—" ? "" : guest.fullName,
                  guestEmail: guest.email === "—" ? "" : guest.email,
                  guestPhone: guest.phone === "—" ? "" : guest.phone,
                  propertyId: guest.propertyId === "—" ? prev.propertyId : guest.propertyId,
                }));
              }}
            >
              <option value="">— Select a guest —</option>
              {guests.map((guest) => (
                <option key={guest.id} value={guest.id}>
                  {guest.fullName} · {guest.email} · {guest.propertyId}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={label}>Guest name</label>
            <input className={field + " mt-2"} value={form.guestName} onChange={set("guestName")} placeholder="Jane Doe" />
          </div>
          <div>
            <label className={label}>Guest email</label>
            <input className={field + " mt-2"} value={form.guestEmail} onChange={set("guestEmail")} placeholder="jane@email.com" />
          </div>
          <div>
            <label className={label}>Guest phone</label>
            <input className={field + " mt-2"} value={form.guestPhone} onChange={set("guestPhone")} placeholder="+1 305 555 0100" />
          </div>
          <div>
            <label className={label}>Property ID</label>
            <input className={field + " mt-2"} value={form.propertyId} onChange={set("propertyId")} placeholder="prop-1" />
          </div>
          <div>
            <label className={label}>Listing URL</label>
            <input className={field + " mt-2"} value={form.listingUrl} onChange={set("listingUrl")} placeholder="https://www.airbnb.com/rooms/…" />
          </div>
          <div>
            <label className={label}>Reservation code</label>
            <input className={field + " mt-2"} value={form.reservationCode} onChange={set("reservationCode")} placeholder="HMXQ2P" />
          </div>
          <div>
            <label className={label}>AirCover / OTA claim ID</label>
            <input className={field + " mt-2"} value={form.aircoverClaimId} onChange={set("aircoverClaimId")} placeholder="Optional" />
          </div>
          <div>
            <label className={label}>Incident date</label>
            <input type="date" className={field + " mt-2"} value={form.incidentDate} onChange={set("incidentDate")} />
          </div>
          <div>
            <label className={label}>Incident time</label>
            <input type="time" className={field + " mt-2"} value={form.incidentTime} onChange={set("incidentTime")} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={label}>Category</label>
            <select className={field + " mt-2"} value={form.category} onChange={set("category")}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={label}>Description of the incident</label>
            <textarea
              rows={4}
              className={field + " mt-2"}
              value={form.description}
              onChange={set("description")}
              placeholder="What happened, in neutral factual language…"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={label}>Actions taken by host</label>
            <textarea
              rows={3}
              className={field + " mt-2"}
              value={form.actionsTaken}
              onChange={set("actionsTaken")}
              placeholder="Messages sent, calls made, NeighborShield alerts triggered…"
            />
          </div>
          <div>
            <label className={label}>Damages claimed (USD)</label>
            <input type="number" min="0" className={field + " mt-2"} value={form.damagesUsd} onChange={set("damagesUsd")} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Witnesses / third parties</label>
            <input
              className={field + " mt-2"}
              value={form.witnesses}
              onChange={set("witnesses")}
              placeholder="Neighbor names, contacts…"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={label}>Evidence attached</label>
            <textarea
              rows={3}
              className={field + " mt-2"}
              value={form.evidenceNotes}
              onChange={set("evidenceNotes")}
              placeholder="Photos, videos, chat logs, NeighborShield alert timestamps…"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={downloadTxt}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-base font-bold text-slate-950 transition hover:bg-emerald-400"
        >
          <Download className="h-5 w-5" /> Export Report (.txt)
        </button>
        <button
          type="button"
          onClick={printPdf}
          className="flex items-center gap-2 rounded-xl bg-sky-500 px-6 py-3 text-base font-bold text-slate-950 transition hover:bg-sky-400"
        >
          <Printer className="h-5 w-5" /> Print / Save as PDF
        </button>
        <span className="flex items-center gap-2 text-sm text-slate-500">
          <FileText className="h-4 w-4" /> Structured for AirCover / OTA Trust &amp; Safety
        </span>
      </div>

      <div>
        <h2 className="mb-3 text-2xl font-bold text-slate-900">Report Preview</h2>
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm leading-relaxed text-slate-700">
          {report}
        </pre>
      </div>
    </div>
  );
}
