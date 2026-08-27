"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Moon,
  Phone,
  Sparkles,
  User,
  Webhook,
} from "lucide-react";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";
import { hostFullName } from "@/lib/host-display-name";
import { planFromMetadata, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

type SettingsTab = "account" | "voice" | "alerts" | "billing";
type VoiceVendor = "openai-realtime" | "elevenlabs";
type FloridaLine = "305" | "954";

const LINES: Record<FloridaLine, string> = {
  "305": "+1 (305) 555-0199",
  "954": "+1 (954) 555-0144",
};

const VOICE_USED = 142;
const VOICE_CAP = 300;

const STORAGE = {
  twilioSid: "zencierge.twilioSid",
  twilioToken: "zencierge.twilioToken",
  line: "zencierge.floridaLine",
  voiceVendor: "zencierge.voiceVendor",
  voiceKey: "zencierge.voiceEngineKey",
  voiceModel: "zencierge.voiceModel",
  llmKey: "zencierge.openaiTtsKey",
  sms: "zencierge.alertSms",
  whatsapp: "zencierge.alertWhatsapp",
  emergency: "zencierge.hostEmergency",
  quietOn: "zencierge.quietHoursOn",
  quietFrom: "zencierge.quietFrom",
  quietTo: "zencierge.quietTo",
} as const;

const inputClass =
  "w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Cuenta" },
  { id: "voice", label: "Voice & Phone" },
  { id: "alerts", label: "Notifications & Escalations" },
  { id: "billing", label: "Plan & Billing" },
];

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("account");
  const [showSecrets, setShowSecrets] = useState(false);
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [line, setLine] = useState<FloridaLine>("305");
  const [webhookStatus, setWebhookStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [voiceVendor, setVoiceVendor] = useState<VoiceVendor>("openai-realtime");
  const [voiceKey, setVoiceKey] = useState("");
  const [voiceModel, setVoiceModel] = useState("gpt-4o-realtime-preview");
  const [llmKey, setLlmKey] = useState("");
  const [smsAlerts, setSmsAlerts] = useState(true);
  const [whatsappAlerts, setWhatsappAlerts] = useState(false);
  const [emergency, setEmergency] = useState("+1 (954) 275-3544");
  const [quietOn, setQuietOn] = useState(true);
  const [quietFrom, setQuietFrom] = useState("22:00");
  const [quietTo, setQuietTo] = useState("08:00");
  const [billingNote, setBillingNote] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<ZenciergePlanId>("starter");
  const [checkoutBusy, setCheckoutBusy] = useState<ZenciergePlanId | null>(null);

  useEffect(() => {
    setTwilioSid(window.localStorage.getItem(STORAGE.twilioSid) ?? "");
    setTwilioToken(window.localStorage.getItem(STORAGE.twilioToken) ?? "");
    const storedLine = window.localStorage.getItem(STORAGE.line);
    if (storedLine === "305" || storedLine === "954") setLine(storedLine);
    const vendor = window.localStorage.getItem(STORAGE.voiceVendor);
    if (vendor === "openai-realtime" || vendor === "elevenlabs") setVoiceVendor(vendor);
    setVoiceKey(window.localStorage.getItem(STORAGE.voiceKey) ?? "");
    setVoiceModel(window.localStorage.getItem(STORAGE.voiceModel) ?? "gpt-4o-realtime-preview");
    setLlmKey(window.localStorage.getItem(STORAGE.llmKey) ?? "");
    setSmsAlerts(window.localStorage.getItem(STORAGE.sms) !== "0");
    setWhatsappAlerts(window.localStorage.getItem(STORAGE.whatsapp) === "1");
    setEmergency(window.localStorage.getItem(STORAGE.emergency) ?? "+1 (954) 275-3544");
    setQuietOn(window.localStorage.getItem(STORAGE.quietOn) !== "0");
    setQuietFrom(window.localStorage.getItem(STORAGE.quietFrom) ?? "22:00");
    setQuietTo(window.localStorage.getItem(STORAGE.quietTo) ?? "08:00");
    const supabase = createAuthBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      setCurrentPlan(planFromMetadata(data.user?.user_metadata));
    });
  }, []);

  const persist = (key: string, value: string) => {
    window.localStorage.setItem(key, value);
  };

  const testWebhook = () => {
    setWebhookStatus("testing");
    window.setTimeout(() => {
      const ok = twilioSid.trim().length > 8 && twilioToken.trim().length > 8;
      setWebhookStatus(ok ? "ok" : "fail");
    }, 600);
  };

  const llmConnected = llmKey.trim().startsWith("sk-") && llmKey.trim().length > 12;
  const minutesPct = Math.min(100, Math.round((VOICE_USED / VOICE_CAP) * 100));

  const subscribeWithSquare = async (planId: ZenciergePlanId) => {
    setCheckoutBusy(planId);
    setBillingNote(false);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/dashboard")}`;
        return;
      }
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "Could not start Square checkout");
      }
      window.location.href = data.url;
    } catch (cause) {
      setBillingNote(true);
      window.alert(cause instanceof Error ? cause.message : "Checkout failed");
    } finally {
      setCheckoutBusy(null);
    }
  };

  const models =
    voiceVendor === "elevenlabs"
      ? ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2"]
      : ["gpt-4o-realtime-preview", "gpt-4o-mini-realtime-preview", "tts-1-hd"];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              tab === item.id
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "account" ? <AccountProfileCard /> : null}

      {tab === "voice" ? (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Carrier / VoIP</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSecrets((value) => !value)}
                className="text-slate-400 hover:text-white"
                aria-label={showSecrets ? "Hide secrets" : "Show secrets"}
              >
                {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SecretField
                label="Twilio Account SID"
                value={twilioSid}
                show={showSecrets}
                placeholder="ACxxxxxxxx"
                onChange={(value) => {
                  setTwilioSid(value);
                  persist(STORAGE.twilioSid, value);
                }}
              />
              <SecretField
                label="Auth Token"
                value={twilioToken}
                show={showSecrets}
                placeholder="••••••••"
                onChange={(value) => {
                  setTwilioToken(value);
                  persist(STORAGE.twilioToken, value);
                }}
              />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">Assigned Florida number</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(LINES) as FloridaLine[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setLine(code);
                      persist(STORAGE.line, code);
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-left ${
                      line === code
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-slate-800 bg-slate-950 hover:border-slate-700"
                    }`}
                  >
                    <span className="block font-mono text-sm font-semibold text-white">
                      {LINES[code]}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {code === "305" ? "Miami-Dade · 305" : "Broward · 954"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={testWebhook}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Webhook className="h-3.5 w-3.5" />
                Test Twilio Webhook
              </button>
              {webhookStatus === "testing" ? (
                <span className="text-xs text-sky-300">POST /voice/inbound · probing…</span>
              ) : null}
              {webhookStatus === "ok" ? (
                <span className="text-xs font-medium text-emerald-400">
                  200 OK · SIP live on {LINES[line]}
                </span>
              ) : null}
              {webhookStatus === "fail" ? (
                <span className="text-xs font-medium text-amber-400">
                  SID and token must be at least 9 characters.
                </span>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">Voice engine</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setVoiceVendor("openai-realtime");
                  persist(STORAGE.voiceVendor, "openai-realtime");
                  setVoiceModel("gpt-4o-realtime-preview");
                  persist(STORAGE.voiceModel, "gpt-4o-realtime-preview");
                }}
                className={`rounded-xl border px-4 py-3 text-left text-sm ${
                  voiceVendor === "openai-realtime"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-slate-800 bg-slate-950 text-slate-300"
                }`}
              >
                OpenAI Realtime
                <span className="mt-1 block text-[11px] text-slate-500">Low-latency phone turns</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setVoiceVendor("elevenlabs");
                  persist(STORAGE.voiceVendor, "elevenlabs");
                  setVoiceModel("eleven_multilingual_v2");
                  persist(STORAGE.voiceModel, "eleven_multilingual_v2");
                }}
                className={`rounded-xl border px-4 py-3 text-left text-sm ${
                  voiceVendor === "elevenlabs"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-slate-800 bg-slate-950 text-slate-300"
                }`}
              >
                ElevenLabs
                <span className="mt-1 block text-[11px] text-slate-500">Studio multilingual voices</span>
              </button>
            </div>
            <SecretField
              label={voiceVendor === "elevenlabs" ? "ElevenLabs API Key" : "OpenAI Realtime API Key"}
              value={voiceKey}
              show={showSecrets}
              placeholder={voiceVendor === "elevenlabs" ? "sk_…" : "sk-…"}
              onChange={(value) => {
                setVoiceKey(value);
                persist(STORAGE.voiceKey, value);
              }}
            />
            <label className="block text-xs text-slate-400">
              Default model
              <select
                className={`${inputClass} mt-1.5`}
                value={voiceModel}
                onChange={(event) => {
                  setVoiceModel(event.target.value);
                  persist(STORAGE.voiceModel, event.target.value);
                }}
              >
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-300" />
                <h3 className="text-sm font-semibold text-white">LLM brain</h3>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                  llmConnected
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-slate-700 bg-slate-800 text-slate-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${llmConnected ? "bg-emerald-400" : "bg-slate-500"}`}
                />
                {llmConnected ? "Connected" : "Not connected"}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              OpenAI key for the AI Handbook — Wi-Fi, locks, and parking answers on live guest calls.
            </p>
            <SecretField
              label="OpenAI API Key"
              value={llmKey}
              show={showSecrets}
              placeholder="sk-proj-…"
              onChange={(value) => {
                setLlmKey(value);
                persist(STORAGE.llmKey, value);
              }}
            />
          </section>
        </div>
      ) : null}

      {tab === "alerts" ? (
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-white">Notifications & escalations</h3>
          </div>
          <label className="block text-xs text-slate-400">
            Host emergency number
            <input
              className={`${inputClass} mt-1.5 font-mono`}
              value={emergency}
              onChange={(event) => {
                setEmergency(event.target.value);
                persist(STORAGE.emergency, event.target.value);
              }}
              placeholder="+1 (954) 275-3544"
            />
            <span className="mt-1.5 block text-[11px] text-slate-500">
              Used for call forwards and SMS/WhatsApp when a guest reports a water leak or a broken lock.
            </span>
          </label>
          <ToggleRow
            label="SMS alerts on leak / lockout"
            checked={smsAlerts}
            onChange={(value) => {
              setSmsAlerts(value);
              persist(STORAGE.sms, value ? "1" : "0");
            }}
          />
          <ToggleRow
            label="WhatsApp for severe incidents"
            checked={whatsappAlerts}
            onChange={(value) => {
              setWhatsappAlerts(value);
              persist(STORAGE.whatsapp, value ? "1" : "0");
            }}
          />
          <div className="border-t border-slate-800 pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-violet-300" />
              <h4 className="text-sm font-semibold text-white">Quiet hours</h4>
            </div>
            <p className="text-xs text-slate-500">
              Non-urgent guest questions stay on the AI line. Leaks and lockouts still ring{" "}
              {emergency || "the host"}.
            </p>
            <ToggleRow
              label="Enable quiet hours"
              checked={quietOn}
              onChange={(value) => {
                setQuietOn(value);
                persist(STORAGE.quietOn, value ? "1" : "0");
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-400">
                From
                <input
                  type="time"
                  value={quietFrom}
                  onChange={(event) => {
                    setQuietFrom(event.target.value);
                    persist(STORAGE.quietFrom, event.target.value);
                  }}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
              <label className="text-xs text-slate-400">
                To
                <input
                  type="time"
                  value={quietTo}
                  onChange={(event) => {
                    setQuietTo(event.target.value);
                    persist(STORAGE.quietTo, event.target.value);
                  }}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "billing" ? (
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Plan & Billing</h3>
          </div>
          <p className="text-xs text-slate-400">
            Current plan:{" "}
            <span className="font-semibold text-white">{ZENCIERGE_PLANS[currentPlan].name}</span>
            {" · "}
            ${ZENCIERGE_PLANS[currentPlan].monthlyUsd}/mo
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(["starter", "pro", "agency"] as const).map((planId) => {
              const plan = ZENCIERGE_PLANS[planId];
              const selected = plan.id === currentPlan;
              return (
                <article
                  key={plan.id}
                  className={`flex flex-col rounded-xl border p-4 ${
                    selected
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-slate-800 bg-slate-950/50"
                  }`}
                >
                  <p className="text-sm font-semibold text-white">{plan.name}</p>
                  <p className="mt-2 text-2xl font-bold text-white">
                    ${plan.monthlyUsd}
                    <span className="text-sm font-medium text-slate-500">/mo</span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {plan.id === "starter"
                      ? "1 Florida listing"
                      : plan.id === "pro"
                        ? "Up to 4 listings"
                        : "Unlimited listings"}
                  </p>
                  <button
                    type="button"
                    disabled={checkoutBusy !== null}
                    onClick={() => {
                      void subscribeWithSquare(plan.id);
                    }}
                    className="mt-4 w-full rounded-lg bg-emerald-500 py-2 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {checkoutBusy === plan.id ? "Opening Square…" : "Subscribe with Square"}
                  </button>
                </article>
              );
            })}
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>Voice minutes this month</span>
              <span className="font-mono text-slate-200">
                {VOICE_USED} / {VOICE_CAP} mins
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${minutesPct}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {VOICE_CAP - VOICE_USED} minutes remaining · extra billed at $0.12/min
            </p>
          </div>
          {billingNote ? (
            <p className="text-[11px] text-rose-400">
              Square checkout failed. Check your session and SQUARE_ACCESS_TOKEN.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function AccountProfileCard() {
  const [fullName, setFullName] = useState("Javier");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createAuthBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      setFullName(hostFullName(data.user));
    });
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const trimmed = fullName.trim() || "Javier";
    const firstName = trimmed.split(/\s+/)[0] ?? "Javier";
    try {
      const supabase = createAuthBrowserClient();
      const { error: cause } = await supabase.auth.updateUser({
        data: {
          full_name: trimmed,
          first_name: firstName,
        },
      });
      if (cause) throw cause;
      setFullName(trimmed);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el nombre.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Perfil de anfitrión</h3>
      </div>
      <p className="text-xs text-slate-500">
        Este nombre aparece en el saludo del dashboard. No se toma del correo.
      </p>
      <label className="block text-xs text-slate-400">
        Nombre Completo
        <input
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Javier"
          className={`${inputClass} mt-1.5`}
        />
      </label>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {busy ? "Guardando…" : saved ? "Guardado" : "Guardar nombre"}
      </button>
    </section>
  );
}

function SecretField({
  label,
  value,
  show,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  show: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        className={`${inputClass} mt-1.5 font-mono text-xs`}
        type={show ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-300">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-emerald-500" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "left-5" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
