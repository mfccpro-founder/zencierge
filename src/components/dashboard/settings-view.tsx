"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  CreditCard,
  Cpu,
  Plus,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";
import { hostFullName } from "@/lib/host-display-name";
import { isDevPreviewUser, readPendingSignup } from "@/lib/pending-signup";
import { HostBillingSummary } from "@/components/dashboard/host-billing-summary";

type HubTab = "profile" | "alerts" | "hardware" | "team" | "billing";
type TeamRole = "cleaner" | "cohost" | "inspector";
type LockVendor = "august" | "yale" | "schlage";
type IcalInterval = "15" | "30" | "60";
type SensorStatus = "synced" | "idle" | "error";

type TeamMember = {
  id: string;
  email: string;
  role: TeamRole;
  status: "active" | "pending";
};

const TABS: { id: HubTab; label: string }[] = [
  { id: "profile", label: "Profile & Business" },
  { id: "alerts", label: "Alert Rules & Notifications" },
  { id: "hardware", label: "Smart Hardware & OTA Integrations" },
  { id: "team", label: "Team & Cleaners Access" },
  { id: "billing", label: "Billing & Subscriptions" },
];

const ROLE_LABEL: Record<TeamRole, string> = {
  cleaner: "Cleaner",
  cohost: "Co-host",
  inspector: "Inspector",
};

const ROLE_PERMS: Record<TeamRole, string> = {
  cleaner: "Housekeeping cards and photo uploads only. No financials or settings.",
  cohost: "Listings, calendar, NeighborShield, and Dispute Dossier. No billing.",
  inspector: "Inspection gallery and damage flags. No guest PII export.",
};

const STORAGE = {
  brand: "zencierge.hub.brand",
  email: "zencierge.hub.email",
  emergency: "zencierge.hostEmergency",
  timezone: "zencierge.hub.timezone",
  currency: "zencierge.hub.currency",
  neighborSms: "zencierge.hub.alertNeighborSms",
  hkSms: "zencierge.hub.alertHkSms",
  damage: "zencierge.hub.alertDamage",
  voiceEscalation: "zencierge.hub.alertVoiceEscalation",
  lockVendor: "zencierge.hub.lockVendor",
  autoPin: "zencierge.hub.autoPin",
  minut: "zencierge.hub.minutSync",
  ical: "zencierge.hub.icalInterval",
  team: "zencierge.hub.team",
} as const;

const DEFAULT_TEAM: TeamMember[] = [
  { id: "tm-1", email: "marisol@cleanco.example", role: "cleaner", status: "active" },
  { id: "tm-2", email: "ops@sunshine-turnovers.example", role: "cleaner", status: "pending" },
];

const field =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none";
const labelClass = "text-sm font-semibold text-slate-900";

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
  const [tab, setTab] = useState<HubTab>(searchParams.get("tab") === "billing" ? "billing" : "profile");
  const [toast, setToast] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [brand, setBrand] = useState("Zencierge Host OS");
  const [email, setEmail] = useState("");
  const [emergency, setEmergency] = useState("+1 (954) 275-3544");
  const [timezone, setTimezone] = useState("America/New_York");
  const [currency, setCurrency] = useState("USD");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [neighborSms, setNeighborSms] = useState(true);
  const [hkSms, setHkSms] = useState(true);
  const [damageAlert, setDamageAlert] = useState(true);
  const [voiceEscalation, setVoiceEscalation] = useState(true);

  const [lockVendor, setLockVendor] = useState<LockVendor>("yale");
  const [autoPin, setAutoPin] = useState(true);
  const [minutStatus, setMinutStatus] = useState<SensorStatus>("synced");
  const [icalInterval, setIcalInterval] = useState<IcalInterval>("15");

  const [team, setTeam] = useState<TeamMember[]>(DEFAULT_TEAM);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("cleaner");

  useEffect(() => {
    if (searchParams.get("tab") === "billing") setTab("billing");
  }, [searchParams]);

  const selectTab = (id: HubTab) => {
    setTab(id);
    router.replace(id === "billing" ? "/dashboard/settings?tab=billing" : "/dashboard/settings", { scroll: false });
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
    const lock = window.localStorage.getItem(STORAGE.lockVendor);
    if (lock === "august" || lock === "yale" || lock === "schlage") setLockVendor(lock);
    setAutoPin(window.localStorage.getItem(STORAGE.autoPin) !== "0");
    const minut = window.localStorage.getItem(STORAGE.minut);
    if (minut === "synced" || minut === "idle" || minut === "error") setMinutStatus(minut);
    const ical = window.localStorage.getItem(STORAGE.ical);
    if (ical === "15" || ical === "30" || ical === "60") setIcalInterval(ical);
    try {
      const raw = window.localStorage.getItem(STORAGE.team);
      if (raw) {
        const parsed = JSON.parse(raw) as TeamMember[];
        if (Array.isArray(parsed) && parsed.length) setTeam(parsed);
      }
    } catch {
      /* keep defaults */
    }

    const supabase = createAuthBrowserClient();
    void supabase.auth.getUser().then(({ data }: { data: { user: { email?: string; user_metadata?: Record<string, unknown> } | null } }) => {
      const pending = readPendingSignup();
      const mock = isDevPreviewUser(data.user);
      if (pending && (!data.user || mock)) {
        setFullName(pending.fullName);
        setEmail(pending.email);
        return;
      }
      setFullName(hostFullName(data.user));
      const storedEmail = window.localStorage.getItem(STORAGE.email);
      setEmail(storedEmail || data.user?.email || pending?.email || "");
    });
  }, []);

  const flashSaved = () => setToast("Settings saved successfully");

  const saveProfile = async () => {
    setProfileBusy(true);
    setProfileError(null);
    const trimmed = fullName.trim() || "Host";
    const firstName = trimmed.split(/\s+/)[0] ?? "Host";
    try {
      const supabase = createAuthBrowserClient();
      const { error } = await supabase.auth.updateUser({
        data: { full_name: trimmed, first_name: firstName },
      });
      if (error) throw error;
      window.localStorage.setItem(STORAGE.brand, brand.trim() || "Zencierge Host OS");
      window.localStorage.setItem(STORAGE.email, email.trim());
      window.localStorage.setItem(STORAGE.emergency, emergency.trim());
      window.localStorage.setItem(STORAGE.timezone, timezone);
      window.localStorage.setItem(STORAGE.currency, currency);
      setFullName(trimmed);
      flashSaved();
    } catch (cause) {
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
    flashSaved();
  };

  const saveHardware = () => {
    window.localStorage.setItem(STORAGE.lockVendor, lockVendor);
    window.localStorage.setItem(STORAGE.autoPin, autoPin ? "1" : "0");
    window.localStorage.setItem(STORAGE.minut, minutStatus);
    window.localStorage.setItem(STORAGE.ical, icalInterval);
    flashSaved();
  };

  const saveTeam = (next: TeamMember[]) => {
    setTeam(next);
    window.localStorage.setItem(STORAGE.team, JSON.stringify(next));
  };

  const invite = () => {
    const value = inviteEmail.trim().toLowerCase();
    if (!value.includes("@")) return;
    const member: TeamMember = {
      id: `tm-${Date.now()}`,
      email: value,
      role: inviteRole,
      status: "pending",
    };
    saveTeam([...team, member]);
    setInviteEmail("");
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

      {tab === "team" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Header
            icon={Users}
            title="Team & cleaners access"
            subtitle="Invite cleaning crew or co-hosts with role-based permissions."
          />
          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_160px_auto]">
            <input
              type="email"
              className={field + " mt-0"}
              placeholder="crew@example.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
            <select className={field + " mt-0"} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as TeamRole)}>
              <option value="cleaner">Cleaner</option>
              <option value="cohost">Co-host</option>
              <option value="inspector">Inspector</option>
            </select>
            <button
              type="button"
              onClick={invite}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
            >
              <Plus className="h-4 w-4" /> Invite
            </button>
          </div>
          <p className="mt-3 text-xs font-medium text-slate-800">{ROLE_PERMS[inviteRole]}</p>

          <ul className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
            {team.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{member.email}</p>
                  <p className="text-xs font-medium text-slate-800">
                    {ROLE_LABEL[member.role]} · {member.status === "active" ? "Active" : "Invite pending"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    saveTeam(team.filter((row) => row.id !== member.id));
                    flashSaved();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </li>
            ))}
          </ul>
          <SaveButton
            label="Save Changes"
            onClick={() => {
              saveTeam(team);
              flashSaved();
            }}
          />
        </section>
      ) : null}

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
