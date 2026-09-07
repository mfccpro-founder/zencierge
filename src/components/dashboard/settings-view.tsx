"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  CreditCard,
  Cpu,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";
import { hostFullName, writeStoredHostProfileName } from "@/lib/host-display-name";
import { isDevPreviewUser, readPendingSignup } from "@/lib/pending-signup";
import {
  HOST_ISABELA_AUTO_VOICE_KEY,
  HOST_LANGUAGE_STORAGE_KEY,
  parseHostBriefingLanguage,
  readIsabelaAutoVoicePreference,
  writeIsabelaAutoVoicePreference,
  writeStoredHostBriefingLanguage,
  type VoiceBriefingLanguage,
} from "@/lib/smart-voice-briefing";
import { TeamCleanersAccessPanel } from "@/components/dashboard/team-cleaners-access";
import { HostBillingSummary } from "@/components/dashboard/host-billing-summary";

type HubTab = "profile" | "alerts" | "hardware" | "team" | "billing";
type LockVendor = "august" | "yale" | "schlage";
type IcalInterval = "15" | "30" | "60";
type SensorStatus = "synced" | "idle" | "error";

const TABS: { id: HubTab; label: string }[] = [
  { id: "profile", label: "Profile & Business" },
  { id: "alerts", label: "Alert Rules & Notifications" },
  { id: "hardware", label: "Smart Hardware & OTA Integrations" },
  { id: "team", label: "Team & Cleaners Access" },
  { id: "billing", label: "Billing & Subscriptions" },
];

const STORAGE = {
  brand: "zencierge.hub.brand",
  fullName: "zencierge.hub.fullName",
  email: "zencierge.hub.email",
  emergency: "zencierge.hostEmergency",
  timezone: "zencierge.hub.timezone",
  language: HOST_LANGUAGE_STORAGE_KEY,
  isabelaAutoVoice: HOST_ISABELA_AUTO_VOICE_KEY,
  currency: "zencierge.hub.currency",
  neighborSms: "zencierge.hub.alertNeighborSms",
  hkSms: "zencierge.hub.alertHkSms",
  damage: "zencierge.hub.alertDamage",
  voiceEscalation: "zencierge.hub.alertVoiceEscalation",
  lockVendor: "zencierge.hub.lockVendor",
  autoPin: "zencierge.hub.autoPin",
  minut: "zencierge.hub.minutSync",
  ical: "zencierge.hub.icalInterval",
} as const;

const field =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none";
const labelClass = "text-sm font-semibold text-slate-900";

function hubTabFromQuery(value: string | null): HubTab {
  if (value === "alerts" || value === "hardware" || value === "team" || value === "billing") return value;
  return "profile";
}

export function SettingsView() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading settings…</div>}>
      <SettingsViewInner />
    </Suspense>
  );
}

function SettingsViewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<HubTab>(hubTabFromQuery(searchParams.get("tab")));
  const [toast, setToast] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [brand, setBrand] = useState("Zencierge Host OS");
  const [email, setEmail] = useState("");
  const [emergency, setEmergency] = useState("+1 (954) 275-3544");
  const [timezone, setTimezone] = useState("America/New_York");
  const [language, setLanguage] = useState<VoiceBriefingLanguage>(() =>
    typeof window === "undefined"
      ? "en"
      : parseHostBriefingLanguage(window.localStorage.getItem(HOST_LANGUAGE_STORAGE_KEY)),
  );
  const [currency, setCurrency] = useState("USD");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [neighborSms, setNeighborSms] = useState(true);
  const [hkSms, setHkSms] = useState(true);
  const [damageAlert, setDamageAlert] = useState(true);
  const [voiceEscalation, setVoiceEscalation] = useState(true);
  const [isabelaAutoVoice, setIsabelaAutoVoice] = useState(true);

  const [lockVendor, setLockVendor] = useState<LockVendor>("yale");
  const [autoPin, setAutoPin] = useState(true);
  const [minutStatus, setMinutStatus] = useState<SensorStatus>("synced");
  const [icalInterval, setIcalInterval] = useState<IcalInterval>("15");

  useEffect(() => {
    setTab(hubTabFromQuery(searchParams.get("tab")));
  }, [searchParams]);

  const selectTab = (id: HubTab) => {
    setTab(id);
    router.replace(id === "profile" ? "/dashboard/settings" : `/dashboard/settings?tab=${id}`, { scroll: false });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setBrand(window.localStorage.getItem(STORAGE.brand) ?? "Zencierge Host OS");
    setEmergency(window.localStorage.getItem(STORAGE.emergency) ?? "+1 (954) 275-3544");
    setTimezone(window.localStorage.getItem(STORAGE.timezone) ?? "America/New_York");
    setCurrency(window.localStorage.getItem(STORAGE.currency) ?? "USD");
    setNeighborSms(window.localStorage.getItem(STORAGE.neighborSms) !== "0");
    setHkSms(window.localStorage.getItem(STORAGE.hkSms) !== "0");
    setDamageAlert(window.localStorage.getItem(STORAGE.damage) !== "0");
    setVoiceEscalation(window.localStorage.getItem(STORAGE.voiceEscalation) !== "0");
    setIsabelaAutoVoice(readIsabelaAutoVoicePreference() !== "disabled");
    const lock = window.localStorage.getItem(STORAGE.lockVendor);
    if (lock === "august" || lock === "yale" || lock === "schlage") setLockVendor(lock);
    setAutoPin(window.localStorage.getItem(STORAGE.autoPin) !== "0");
    const minut = window.localStorage.getItem(STORAGE.minut);
    if (minut === "synced" || minut === "idle" || minut === "error") setMinutStatus(minut);
    const ical = window.localStorage.getItem(STORAGE.ical);
    if (ical === "15" || ical === "30" || ical === "60") setIcalInterval(ical);

    const supabase = createAuthBrowserClient();
    void supabase.auth.getUser().then(({ data }: { data: { user: { email?: string; user_metadata?: Record<string, unknown> } | null } }) => {
      const pending = readPendingSignup();
      const mock = isDevPreviewUser(data.user);
      if (pending && (!data.user || mock)) {
        setFullName(window.localStorage.getItem(STORAGE.fullName) || pending.fullName);
        setEmail(pending.email);
        return;
      }
      const storedName = window.localStorage.getItem(STORAGE.fullName)?.trim();
      setFullName(storedName || hostFullName(data.user) || "Javier E Murphy");
      const storedEmail = window.localStorage.getItem(STORAGE.email);
      setEmail(storedEmail || data.user?.email || pending?.email || "");
    });
  }, []);

  const flashSaved = (message = "Settings saved successfully") => setToast(message);

  const saveProfileLocally = (name: string) => {
    window.localStorage.setItem(STORAGE.brand, brand.trim() || "Zencierge Host OS");
    window.localStorage.setItem(STORAGE.email, email.trim());
    window.localStorage.setItem(STORAGE.emergency, emergency.trim());
    window.localStorage.setItem(STORAGE.timezone, timezone);
    writeStoredHostBriefingLanguage(language);
    window.localStorage.setItem(STORAGE.currency, currency);
    writeStoredHostProfileName(name);
    setFullName(name);
  };

  const saveProfile = async () => {
    setProfileBusy(true);
    setProfileError(null);
    const trimmed = fullName.trim() || "Host";
    const firstName = trimmed.split(/\s+/)[0] ?? "Host";
    saveProfileLocally(trimmed);
    try {
      const supabase = createAuthBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        flashSaved("Profile saved locally");
        return;
      }
      const { error } = await supabase.auth.updateUser({
        data: { full_name: trimmed, first_name: firstName },
      });
      if (error) throw error;
      if (data.session.user.id) {
        try {
          await supabase.from("host_profiles").upsert(
            { user_id: data.session.user.id, full_name: trimmed },
            { onConflict: "user_id" },
          );
        } catch {
          /* table may not exist yet — localStorage and auth metadata still update the banner */
        }
      }
      flashSaved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (/auth session missing|session/i.test(message)) {
        flashSaved("Profile saved locally");
        return;
      }
      setProfileError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setProfileBusy(false);
    }
  };

  const saveAlerts = () => {
    window.localStorage.setItem(STORAGE.neighborSms, neighborSms ? "1" : "0");
    window.localStorage.setItem(STORAGE.hkSms, hkSms ? "1" : "0");
    window.localStorage.setItem(STORAGE.damage, damageAlert ? "1" : "0");
    window.localStorage.setItem(STORAGE.voiceEscalation, voiceEscalation ? "1" : "0");
    writeIsabelaAutoVoicePreference(isabelaAutoVoice ? "enabled" : "disabled");
    flashSaved();
  };

  const saveHardware = () => {
    window.localStorage.setItem(STORAGE.lockVendor, lockVendor);
    window.localStorage.setItem(STORAGE.autoPin, autoPin ? "1" : "0");
    window.localStorage.setItem(STORAGE.minut, minutStatus);
    window.localStorage.setItem(STORAGE.ical, icalInterval);
    flashSaved();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-tour="settings-hub">
      {toast ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-slate-900">
          {toast}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectTab(item.id)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${
              tab === item.id ? "bg-sky-600 text-white" : "text-slate-900 hover:bg-slate-100"
            }`}
          >
            {item.id === "billing" ? <CreditCard className="h-3.5 w-3.5" /> : null}
            {item.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Header icon={User} title="Profile & Business" subtitle="How you appear in Host OS and on guest-facing notices." />
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field label="Host full name">
              <input className={field} value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </Field>
            <Field label="Company / host brand name">
              <input className={field} value={brand} onChange={(event) => setBrand(event.target.value)} />
            </Field>
            <Field label="Contact email">
              <input type="email" className={field} value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            <Field label="Emergency phone">
              <input className={field} value={emergency} onChange={(event) => setEmergency(event.target.value)} />
            </Field>
            <Field label="Default timezone">
              <select className={field} value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="America/New_York">Eastern Time — US & Canada</option>
                <option value="America/Chicago">Central Time — US & Canada</option>
                <option value="America/Denver">Mountain Time — US & Canada</option>
                <option value="America/Los_Angeles">Pacific Time — US & Canada</option>
              </select>
            </Field>
            <Field label="Dashboard language / Idioma">
              <select
                className={field}
                value={language}
                onChange={(event) => setLanguage(parseHostBriefingLanguage(event.target.value))}
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </Field>
            <Field label="Currency">
              <select className={field} value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="USD">USD — US Dollar</option>
              </select>
            </Field>
          </div>
          {profileError ? <p className="mt-4 text-sm font-semibold text-rose-700">{profileError}</p> : null}
          <SaveButton
            label={profileBusy ? "Saving…" : "Save Profile"}
            disabled={profileBusy}
            onClick={() => void saveProfile()}
          />
        </section>
      ) : null}

      {tab === "alerts" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Header
            icon={Bell}
            title="Alert rules & notifications"
            subtitle="Instant SMS and call routing for noise, turnovers, damage, and Elena emergencies."
          />
          <div className="mt-6 space-y-3">
            <ToggleRow
              title="NeighborShield SMS alerts for noise spikes"
              description="Text the host when a sensor reports noise above 75 dB during a stay."
              checked={neighborSms}
              onChange={setNeighborSms}
            />
            <ToggleRow
              title="Housekeeping instant SMS when inspection photos are uploaded"
              description="Notify as soon as pre-clean or turn-ready photos land in the gallery."
              checked={hkSms}
              onChange={setHkSms}
            />
            <ToggleRow
              title="Damage flag instant notification"
              description="Alert when a cleaner or inspector flags damage on a pre-cleaning photo."
              checked={damageAlert}
              onChange={setDamageAlert}
            />
            <ToggleRow
              title="Voice Concierge emergency call escalation"
              description="Ring the emergency phone when Elena detects a leak, lockout, or safety event."
              checked={voiceEscalation}
              onChange={setVoiceEscalation}
            />
            <ToggleRow
              title="Isabela auto-speak on dashboard open"
              description="When enabled, Isabela greets you with the Smart Login Briefing when Overview loads (browser permitting)."
              checked={isabelaAutoVoice}
              onChange={setIsabelaAutoVoice}
            />
          </div>
          <SaveButton label="Save Changes" onClick={saveAlerts} />
        </section>
      ) : null}

      {tab === "hardware" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Header
            icon={Cpu}
            title="Smart hardware & OTA integrations"
            subtitle="Locks, noise sensors, and calendar sync for Airbnb and Vrbo."
          />
          <div className="mt-6 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-900">Smart lock status</p>
              <p className="mt-1 text-sm text-slate-800">August / Yale / Schlage — choose the brand on the door, then enable Auto-PIN provisioning for each reservation.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Lock brand">
                  <select className={field} value={lockVendor} onChange={(event) => setLockVendor(event.target.value as LockVendor)}>
                    <option value="august">August</option>
                    <option value="yale">Yale</option>
                    <option value="schlage">Schlage</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <span
                    className={`mb-1 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${
                      autoPin
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-300 bg-white text-slate-800"
                    }`}
                  >
                    {autoPin ? "Auto-PIN on" : "Auto-PIN off"} · {lockVendor === "august" ? "August" : lockVendor === "yale" ? "Yale" : "Schlage"}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <ToggleRow
                  title="Auto-PIN provisioning"
                  description="Issue a unique guest PIN at check-in and revoke it at checkout."
                  checked={autoPin}
                  onChange={setAutoPin}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-900">Minut / NoiseAware sensor webhook</p>
              <p className="mt-1 text-sm text-slate-800">Sync status for occupancy and noise events used by NeighborShield.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-bold ${
                    minutStatus === "synced"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : minutStatus === "error"
                        ? "border-rose-200 bg-rose-50 text-rose-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {minutStatus === "synced" ? "Synced" : minutStatus === "error" ? "Sync error" : "Idle — not connected"}
                </span>
                <button
                  type="button"
                  onClick={() => setMinutStatus("synced")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100"
                >
                  Re-sync webhook
                </button>
              </div>
            </div>

            <Field label="Airbnb / Vrbo iCal auto-refresh interval">
              <select className={field} value={icalInterval} onChange={(event) => setIcalInterval(event.target.value as IcalInterval)}>
                <option value="15">Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every 60 minutes</option>
              </select>
            </Field>
          </div>
          <SaveButton label="Save Changes" onClick={saveHardware} />
        </section>
      ) : null}

      {tab === "team" ? <TeamCleanersAccessPanel /> : null}

      {tab === "billing" ? <HostBillingSummary /> : null}
    </div>
  );
}

function Header({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof User;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="border-b border-slate-200 pb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-sky-700" />
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      </div>
      <p className="mt-1 text-sm font-medium text-slate-800">{subtitle}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function SaveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-6 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"
    >
      {label}
    </button>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div>
        <p className="text-sm font-bold text-slate-900">{title}</p>
        <p className="mt-1 text-xs font-medium text-slate-800">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-sky-600" : "bg-slate-300"}`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "left-5" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
