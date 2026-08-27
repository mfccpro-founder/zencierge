"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Camera,
  Check,
  CreditCard,
  FileText,
  IdCard,
  KeyRound,
  Loader2,
  MapPin,
  PenLine,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import type { Property, Reservation } from "@/lib/dashboard-data";
import { properties as seedProperties, reservations as seedReservations } from "@/lib/dashboard-data";
import { fetchPropertyById, fetchReservationById } from "@/lib/supabase-listings";

const STEPS = [
  { id: 1, label: "ID" },
  { id: 2, label: "Hold" },
  { id: 3, label: "Rules" },
  { id: 4, label: "Access" },
] as const;

const HOUSE_RULES = [
  "No parties, events, or gatherings beyond the registered guests on this booking.",
  "Quiet hours are 10:00 PM–8:00 AM. Excessive noise is grounds for immediate eviction without refund.",
  "This is a licensed short-term rental. Staying past checkout, refusing to leave, or claiming tenancy is prohibited (anti-squatting).",
  "The security deposit hold of $250 may be captured for damages, unauthorized occupancy, or house-rule violations.",
  "Smart lock codes are for registered guests only and must not be shared with unlisted visitors.",
];

type PhotoSlot = { file: File | null; preview: string | null };

function emptyPhoto(): PhotoSlot {
  return { file: null, preview: null };
}

export function GuestVerifyWizard({ bookingId }: { bookingId: string }) {
  const [loadingStay, setLoadingStay] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [property, setProperty] = useState<Property | null>(null);

  const [step, setStep] = useState(1);
  const [idPhoto, setIdPhoto] = useState<PhotoSlot>(emptyPhoto);
  const [selfie, setSelfie] = useState<PhotoSlot>(emptyPhoto);
  const [stepError, setStepError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [holdAuthorized, setHoldAuthorized] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [handbookOpen, setHandbookOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const booking =
          (await fetchReservationById(bookingId)) ??
          seedReservations.find((row) => row.id === bookingId) ??
          null;
        const propertyId = booking?.propertyId ?? bookingId;
        const stay =
          (await fetchPropertyById(propertyId)) ??
          seedProperties.find((row) => row.id === propertyId) ??
          null;
        if (cancelled) return;
        if (!booking && !stay) {
          setLoadError("We couldn’t find this booking.");
          return;
        }
        setReservation(booking);
        setProperty(stay);
      } catch (cause) {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : "Could not load this booking.");
        }
      } finally {
        if (!cancelled) setLoadingStay(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  useEffect(() => {
    return () => {
      if (idPhoto.preview) URL.revokeObjectURL(idPhoto.preview);
      if (selfie.preview) URL.revokeObjectURL(selfie.preview);
    };
  }, [idPhoto.preview, selfie.preview]);

  const guestName = reservation?.guest ?? "Guest";
  const propertyName = property?.name ?? "Your stay";
  const accessCode = reservation?.accessCode ?? property?.doorCode ?? "————";

  const goNext = async () => {
    setStepError(null);
    if (step === 1) {
      if (!idPhoto.file || !selfie.file) {
        setStepError("Upload a photo of your ID and a matching selfie to continue.");
        return;
      }
      setBusy(true);
      await wait(700);
      setBusy(false);
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!holdAuthorized) {
        setStepError("Authorize the $250 Square hold to continue.");
        return;
      }
      setStep(3);
      return;
    }
    if (step === 3) {
      if (!agreed || !signed) {
        setStepError("Read the agreement, check the box, and sign with your finger or stylus.");
        return;
      }
      setBusy(true);
      await wait(900);
      setBusy(false);
      setStep(4);
    }
  };

  const authorizeHold = async () => {
    setStepError(null);
    setBusy(true);
    await wait(1100);
    setHoldAuthorized(true);
    setBusy(false);
  };

  if (loadingStay) {
    return (
      <Shell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          <p className="text-sm">Preparing verification…</p>
        </div>
      </Shell>
    );
  }

  if (loadError || !property) {
    return (
      <Shell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-slate-400">{loadError ?? "Booking not found."}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="px-5 pt-8 pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-400/80">
          Zencierge · Verify
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Guest verification</h1>
        <p className="mt-1 text-sm text-slate-400">
          {guestName} · {propertyName}
        </p>
        <Progress step={step} />
      </header>

      <div className="flex-1 px-5 pb-8">
        {step === 1 ? (
          <section className="space-y-4">
            <StepHeading
              icon={<IdCard className="h-4 w-4" />}
              title="Identity"
              body="Upload a government ID and a live selfie. We only use these to confirm you are the booked guest."
            />
            <PhotoPicker
              label="Photo of ID"
              hint="Driver license or passport"
              accept="image/*"
              value={idPhoto}
              onChange={setIdPhoto}
            />
            <PhotoPicker
              label="Selfie"
              hint="Face clearly visible, no sunglasses"
              accept="image/*"
              capture="user"
              value={selfie}
              onChange={setSelfie}
            />
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <StepHeading
              icon={<CreditCard className="h-4 w-4" />}
              title="Refundable security hold"
              body="Square places a $250 authorization on your card. It is released after checkout if the home is left as found."
            />
            <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <SquareMark />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Checkout API
                </span>
              </div>
              <div className="px-4 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Security deposit
                </p>
                <p className="mt-1 text-3xl font-bold text-white">
                  $250.00 <span className="text-sm font-medium text-slate-500">USD</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Authorization hold only — not a charge. Refundable after inspection, typically 1–3
                  business days.
                </p>
                <dl className="mt-4 space-y-2 text-xs text-slate-400">
                  <Row k="Booking" v={bookingId} />
                  <Row k="Property" v={propertyName} />
                  <Row k="Card" v="Visa ······4242" />
                </dl>
                {holdAuthorized ? (
                  <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Hold authorized with Square
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void authorizeHold()}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#006aff] py-3.5 text-sm font-bold text-white hover:bg-[#0058d6] disabled:opacity-70"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Contacting Square…
                      </>
                    ) : (
                      "Authorize $250 hold"
                    )}
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <StepHeading
              icon={<FileText className="h-4 w-4" />}
              title="House Rules"
              body="Anti-Party & Anti-Squatting Agreement. Read fully, then sign on the canvas."
            />
            <article className="max-h-52 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
              {HOUSE_RULES.map((rule) => (
                <p key={rule} className="text-xs leading-relaxed text-slate-300">
                  {rule}
                </p>
              ))}
            </article>
            <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500"
              />
              I agree to the Anti-Party & Anti-Squatting Agreement for this stay.
            </label>
            <SignaturePad onSignedChange={setSigned} />
          </section>
        ) : null}

        {step === 4 ? (
          <section className="space-y-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/15">
              <ShieldCheck className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5 text-xs font-bold tracking-[0.22em] text-emerald-300">
              VERIFIED
            </p>
            <div>
              <h2 className="text-xl font-semibold text-white">You’re cleared to check in</h2>
              <p className="mt-2 text-sm text-slate-400">
                Identity, Square hold, and house rules are complete for {propertyName}.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950 px-5 py-6">
              <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                Smart access code
              </p>
              <p className="mt-2 font-mono text-4xl font-bold tracking-[0.18em] text-white">{accessCode}</p>
              <p className="mt-2 text-xs text-slate-500">{property.smartlock}</p>
            </div>
            <button
              type="button"
              onClick={() => setHandbookOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Wifi className="h-4 w-4" />
              Ver manual digital (Wi-Fi y Parking)
            </button>
            <Link
              href={`/guest/${property.id}`}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-700 py-3 text-xs font-semibold text-slate-200 hover:bg-slate-900"
            >
              Open guest concierge
            </Link>
          </section>
        ) : null}

        {stepError ? <p className="mt-4 text-center text-xs text-rose-400">{stepError}</p> : null}

        {step < 4 ? (
          <div className="mt-6 flex gap-3">
            {step > 1 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setStepError(null);
                  setStep((current) => current - 1);
                }}
                className="flex-1 rounded-2xl border border-slate-700 py-3 text-xs font-semibold text-slate-300 disabled:opacity-50"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void goNext()}
              className="flex-[2] inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-70"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : step === 3 ? (
                "Complete verification"
              ) : (
                "Continue"
              )}
            </button>
          </div>
        ) : null}
      </div>

      {handbookOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#101218] p-5 shadow-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Digital handbook
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">{propertyName}</h3>
            <div className="mt-4 space-y-3 text-left">
              <HandbookRow icon={<Wifi className="h-4 w-4" />} label="Wi-Fi" value={`${property.wifiNetwork} · ${property.wifiPassword}`} />
              <HandbookRow icon={<MapPin className="h-4 w-4" />} label="Parking" value={property.parking} />
              <HandbookRow icon={<KeyRound className="h-4 w-4" />} label="Gate" value={property.gateCode} />
            </div>
            <button
              type="button"
              onClick={() => setHandbookOpen(false)}
              className="mt-5 w-full rounded-2xl border border-slate-700 py-2.5 text-xs font-semibold text-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#07080c] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">{children}</div>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="mt-6">
      <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {STEPS.map((item) => (
          <span key={item.id} className={item.id <= step ? "text-emerald-400" : ""}>
            {item.label}
          </span>
        ))}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all duration-300"
          style={{ width: `${(step / STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function StepHeading({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-400">
        {icon}
        {title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}

function PhotoPicker({
  label,
  hint,
  accept,
  capture,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  accept: string;
  capture?: "user" | "environment";
  value: PhotoSlot;
  onChange: (next: PhotoSlot) => void;
}) {
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (value.preview) URL.revokeObjectURL(value.preview);
    onChange({
      file,
      preview: file ? URL.createObjectURL(file) : null,
    });
  };

  return (
    <label className="block cursor-pointer overflow-hidden rounded-3xl border border-dashed border-slate-700 bg-slate-950/60">
          <input type="file" accept={accept} capture={capture} className="sr-only" onChange={onFile} />
      {value.preview ? (
        <img src={value.preview} alt={label} className="h-44 w-full object-cover" />
      ) : (
        <div className="flex h-44 flex-col items-center justify-center gap-2 px-4 text-center">
          <Camera className="h-6 w-6 text-slate-500" />
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="text-[11px] text-slate-500">{hint}</p>
        </div>
      )}
      {value.preview ? (
        <p className="border-t border-slate-800 px-4 py-2 text-center text-[11px] text-emerald-400">
          Tap to replace · {value.file?.name}
        </p>
      ) : null}
    </label>
  );
}

function SignaturePad({ onSignedChange }: { onSignedChange: (signed: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const ink = useRef(false);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    canvasRef.current?.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const onMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!ink.current) {
      ink.current = true;
      onSignedChange(true);
    }
  };

  const onUp = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    resize();
    ink.current = false;
    onSignedChange(false);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <PenLine className="h-3.5 w-3.5" />
          Sign here
        </span>
        <button type="button" onClick={clear} className="text-[11px] font-semibold text-slate-500 hover:text-white">
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-36 w-full touch-none rounded-2xl border border-slate-700 bg-slate-950"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />
    </div>
  );
}

function SquareMark() {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#006aff] text-[11px] font-black">
        □
      </span>
      Square
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{k}</dt>
      <dd className="truncate font-medium text-slate-200">{v}</dd>
    </div>
  );
}

function HandbookRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
      <span className="mt-0.5 text-emerald-400">{icon}</span>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-0.5 text-sm text-slate-200">{value}</p>
      </div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
