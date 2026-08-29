"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

type RiskLevel = "clear" | "watch" | "flagged" | "unknown";
type RiskPayload = { level?: RiskLevel; notes?: string | null };
type Registered = { fullName: string; risk: RiskLevel; riskNotes: string | null };

const RISK_BADGE: Record<RiskLevel, { label: string; className: string; icon: typeof ShieldCheck }> = {
  clear: { label: "Safety check passed", className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300", icon: ShieldCheck },
  watch: { label: "Under watch — please respect the house rules", className: "border-amber-500/40 bg-amber-500/15 text-amber-300", icon: ShieldAlert },
  flagged: { label: "Flagged — the host has been notified of this check-in", className: "border-rose-500/40 bg-rose-500/15 text-rose-300", icon: ShieldAlert },
  unknown: { label: "Safety status unavailable", className: "border-slate-600/60 bg-slate-700/40 text-slate-300", icon: ShieldQuestion },
};

export function GuestGate({
  propertyId,
  propertyName,
  children,
}: {
  propertyId: string;
  propertyName: string;
  children: ReactNode;
}) {
  const storageKey = `zencierge.guestGate.${propertyId}`;
  const [registered, setRegistered] = useState<Registered | null>(null);
  const [ready, setReady] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setRegistered(JSON.parse(raw) as Registered);
    } catch {
      /* ignore corrupt storage */
    }
    setReady(true);
  }, [storageKey]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/guest/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, fullName, phone, email }),
      });
      const payload = (await res.json()) as { error?: string; risk?: RiskPayload };
      if (!res.ok) throw new Error(payload.error ?? "Check-in failed. Please try again.");
      const next = { fullName: fullName.trim(), risk: payload.risk?.level ?? "unknown", riskNotes: payload.risk?.notes ?? null };
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setRegistered(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return null;

  if (registered) {
    const badge = RISK_BADGE[registered.risk];
    const Icon = badge.icon;
    return (
      <>
        <div className={`mx-auto max-w-md mb-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs ${badge.className}`}>
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="block font-semibold">Welcome back, {registered.fullName.split(" ")[0]} ✅</span>
            {badge.label}
            {registered.riskNotes ? <span className="mt-0.5 block opacity-80">{registered.riskNotes}</span> : null}
          </span>
        </div>
        {children}
      </>
    );
  }

  return (
    <GateForm
      onSubmit={submit}
      submitting={submitting}
      error={error}
      propertyName={propertyName}
      fullName={fullName}
      phone={phone}
      email={email}
      onFullName={setFullName}
      onPhone={setPhone}
      onEmail={setEmail}
    />
  );
}

function GateForm({
  onSubmit,
  submitting,
  error,
  propertyName,
  fullName,
  phone,
  email,
  onFullName,
  onPhone,
  onEmail,
}: {
  onSubmit: (event: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
  propertyName: string;
  fullName: string;
  phone: string;
  email: string;
  onFullName: (value: string) => void;
  onPhone: (value: string) => void;
  onEmail: (value: string) => void;
}) {
  return (
    <div className="min-h-dvh bg-[#07080c] text-slate-100 relative z-10 touch-manipulation" suppressHydrationWarning>
      <div className="mx-auto max-w-md px-5 pt-10 pb-20">
        <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/80 font-semibold">Zencierge · Guest Check-in</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Welcome to {propertyName}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Verify your check-in to unlock the Wi-Fi credentials, door access code, and Elena AI — your 24/7 bilingual concierge.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <div>
            <label htmlFor="gate-name" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Full name
            </label>
            <input
              id="gate-name"
              type="text"
              required
              minLength={2}
              autoComplete="name"
              placeholder="Jane Doe"
              value={fullName}
              onChange={(event) => onFullName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-base text-white placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="gate-phone" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              WhatsApp phone
            </label>
            <input
              id="gate-phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="+1 (305) 555-0142"
              value={phone}
              onChange={(event) => onPhone(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-base text-white placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="gate-email" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Email
            </label>
            <input
              id="gate-email"
              type="email"
              required
              autoComplete="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-base text-white placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-base font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
            {submitting ? "Verifying…" : "Check in & Unlock Portal"}
          </button>
          <p className="text-center text-[11px] leading-relaxed text-slate-600">
            Your details are used only for safety verification and stay support. Standard rates may apply for SMS/WhatsApp.
          </p>
        </form>
      </div>
    </div>
  );
}
