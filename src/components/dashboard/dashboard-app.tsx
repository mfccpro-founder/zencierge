"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Building2,
  CalendarDays,
  Headphones,
  LayoutDashboard,
  Settings,
  PhoneCall,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  TrendingUp,
  MapPin,
  Clock,
} from "lucide-react";
import {
  calls,
  calendarToday,
  metrics,
  operations,
  type NavId,
  type Call,
} from "@/lib/dashboard-data";
import { useListings } from "@/components/dashboard/listings-provider";
import { PropertiesView } from "@/components/dashboard/properties-view";
import { VoiceConciergeView } from "@/components/dashboard/voice-concierge-view";
import { CalendarView } from "@/components/dashboard/calendar-view";
import { FinancesView } from "@/components/dashboard/finances-view";
import { SettingsView } from "@/components/dashboard/settings-view";
import { AiAvatarGuide, type AiAvatarGuideHandle } from "@/components/dashboard/ai-avatar-guide";
import { ReceptionistAvatar } from "@/components/dashboard/receptionist-avatar";
import { HostSignOutButton } from "@/components/auth/host-sign-out-button";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";
import { hostDisplayName } from "@/lib/host-display-name";

const navItems: { id: NavId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "properties", label: "Properties", icon: Building2 },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "finances", label: "Financials", icon: Banknote },
  { id: "voice", label: "Voice Concierge", icon: Headphones },
  { id: "settings", label: "Settings", icon: Settings },
];

const pageMeta: Record<NavId, { title: string; subtitle: string }> = {
  overview: {
    title: "Host Command Center",
    subtitle: "Live operations · 4 active properties in South Florida",
  },
  properties: {
    title: "Properties & Knowledge Base",
    subtitle: "Door codes, Wi-Fi, parking, occupancy, and AI handbooks",
  },
  calendar: {
    title: "Calendar",
    subtitle: "Reservations and turnover windows",
  },
  finances: {
    title: "Financial & Revenue Command Center",
    subtitle: "Net profit, ADR, occupancy, and payouts across your Florida listings",
  },
  voice: {
    title: "Voice Concierge",
    subtitle: "AI Receptionist avatar, handbook grounding, and live call tools",
  },
  settings: {
    title: "Settings",
    subtitle: "Voice & phone, escalations, and Pro Superhost billing",
  },
};

export function DashboardApp({ initialTab = "overview" }: { initialTab?: NavId }) {
  const [activeTab, setActiveTab] = useState<NavId>(initialTab);
  const [selectedCall, setSelectedCall] = useState<Call | null>(calls[0]);
  const avatarGuideRef = useRef<AiAvatarGuideHandle>(null);
  const [hostName, setHostName] = useState("Javier");
  const meta = pageMeta[activeTab];
  const showPageHeader = activeTab !== "voice";

  useEffect(() => {
    const supabase = createAuthBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      setHostName(hostDisplayName(data.user));
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setHostName(hostDisplayName(session?.user ?? null));
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-64 border-r border-slate-800/80 bg-slate-900/50 p-4 flex flex-col justify-between backdrop-blur-xl">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-lg shadow-lg shadow-emerald-500/10">
              Z
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white">Zencierge</h1>
              <p className="text-xs text-slate-400">Host OS · Florida</p>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
                  {item.label}
                  {item.id === "voice" ? (
                    <span className="ml-auto text-[9px] uppercase tracking-wide font-semibold text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">
                      Avatar
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-medium text-slate-300">Voice Line Active</span>
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-mono">
              +1 (305) 555-0199
            </span>
          </div>
          <HostSignOutButton />
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">¡Bienvenido, {hostName}! 👋</h1>
            <p className="mt-1 text-sm text-slate-400">Panel de Control de Anfitrión | Zencierge</p>
            {showPageHeader ? (
              <div className="mt-4">
                <h2 className="text-lg font-semibold text-white tracking-tight">{meta.title}</h2>
                <p className="text-sm text-slate-500 mt-0.5">{meta.subtitle}</p>
              </div>
            ) : null}
          </div>
          <StatusChrome
            onOpenReceptionist={() => setActiveTab("voice")}
            onOpenTutorial={() => avatarGuideRef.current?.openTutorial()}
          />
        </div>

        <div key={activeTab} className="view-enter">
          {activeTab === "overview" ? (
            <OverviewPanel selectedCall={selectedCall} setSelectedCall={setSelectedCall} />
          ) : null}
          {activeTab === "properties" ? <PropertiesView /> : null}
          {activeTab === "calendar" ? (
            <CalendarView onWatchSyncGuide={() => avatarGuideRef.current?.openCalendarSync()} />
          ) : null}
          {activeTab === "finances" ? <FinancesView /> : null}
          {activeTab === "voice" ? <VoiceConciergeView /> : null}
          {activeTab === "settings" ? <SettingsView /> : null}
        </div>
      </main>
      <AiAvatarGuide
        ref={avatarGuideRef}
        onTestVoiceCall={() => setActiveTab("voice")}
        onStartSetup={() => setActiveTab("properties")}
      />
    </div>
  );
}

function StatusChrome({
  onOpenReceptionist,
  onOpenTutorial,
}: {
  onOpenReceptionist: () => void;
  onOpenTutorial: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onOpenTutorial}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/15 border border-violet-400/30 text-violet-200 text-xs font-semibold hover:bg-violet-500/25 transition-colors shadow-sm shadow-violet-500/10"
      >
        🎓 Video Guía / Tutorial
      </button>
      <button
        type="button"
        onClick={() => {
          onOpenReceptionist();
          window.requestAnimationFrame(() => {
            document.getElementById("ai-receptionist")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
        className="flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
      >
        <ReceptionistAvatar phase="idle" size="sm" name="Elena" />
        AI Receptionist Ready
      </button>
      <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-white">
        JM
      </div>
    </div>
  );
}

function OverviewPanel({
  selectedCall,
  setSelectedCall,
}: {
  selectedCall: Call | null;
  setSelectedCall: (call: Call | null) => void;
}) {
  const { properties, reservations } = useListings();
  const upcoming = reservations
    .filter((item) => item.checkIn >= calendarToday)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkInTime.localeCompare(b.checkInTime))
    .slice(0, 4);

  const propertyLabel = (id: string) =>
    properties.find((property) => property.id === id)?.name ?? id;

  const whenLabel = (iso: string, time: string) =>
    iso === calendarToday ? `Today, ${time}` : `${iso} · ${time}`;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Monthly Earnings
            </span>
            <Banknote className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-white mt-3">{metrics.monthlyEarnings}</div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2 font-medium">
            <TrendingUp className="h-3.5 w-3.5" />
            {metrics.earningsTrend}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Occupancy Rate
            </span>
            <Building2 className="h-4 w-4 text-sky-400" />
          </div>
          <div className="text-3xl font-extrabold text-white mt-3">{metrics.occupancyRate}</div>
          <div className="text-xs text-slate-400 mt-2">{metrics.occupancyDays}</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Upcoming Check-ins
            </span>
            <CalendarDays className="h-4 w-4 text-violet-400" />
          </div>
          <div className="text-3xl font-extrabold text-white mt-3">{upcoming.length}</div>
          <div className="text-xs text-slate-400 mt-2">{metrics.checkInsSubtitle}</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Phone Assistant
            </span>
            <Headphones className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2 text-3xl font-extrabold text-emerald-400 mt-3">
            <span className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse"></span>
            {metrics.phoneAssistantStatus}
          </div>
          <div className="text-xs text-slate-400 mt-2">{metrics.phoneAssistantSub}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-emerald-400" />
              <h3 className="font-semibold text-white text-base">Recent Voice Concierge Calls</h3>
            </div>
            <span className="text-xs text-emerald-400 hover:underline cursor-pointer">
              View voice inbox
            </span>
          </div>

          <div className="space-y-3">
            {calls.map((call) => {
              const isSelected = selectedCall?.id === call.id;
              return (
                <div
                  key={call.id}
                  onClick={() => setSelectedCall(isSelected ? null : call)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-slate-900 border-emerald-500/40 shadow-md"
                      : "bg-slate-900/40 border-slate-800/70 hover:bg-slate-900/80 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
                        <Headphones className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-sm">{call.guest}</span>
                          <span className="text-xs text-slate-400">· {call.property}</span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5">{call.summary}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500">{call.time}</span>
                      <div className="mt-1">
                        {call.status === "resolved_ai" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-3 w-3" /> Solved by AI
                          </span>
                        )}
                        {call.status === "escalated_host" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="h-3 w-3" /> Escalation to Host
                          </span>
                        )}
                        {call.status === "routed_ops" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded-full">
                            <Wrench className="h-3 w-3" /> Routed to Ops
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-2 bg-slate-950/40 p-3 rounded-lg">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Call Transcript
                      </span>
                      {call.transcript.map((line, idx) => (
                        <div key={idx} className="text-xs flex gap-2">
                          <span
                            className={`font-semibold capitalize min-w-[70px] ${
                              line.speaker === "ai" ? "text-emerald-400" : "text-slate-300"
                            }`}
                          >
                            {line.speaker === "ai" ? "Zencierge:" : `${line.speaker}:`}
                          </span>
                          <span className="text-slate-300">{line.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
            <h3 className="font-semibold text-white text-sm">Upcoming Check-ins</h3>
            <div className="space-y-3">
              {upcoming.length === 0 ? (
                <p className="text-xs text-slate-500">No upcoming stays in listings.</p>
              ) : null}
              {upcoming.map((checkin) => (
                <div
                  key={checkin.id}
                  className="flex items-center justify-between pb-3 border-b border-slate-800/60 last:border-0 last:pb-0"
                >
                  <div>
                    <div className="text-sm font-medium text-white">{checkin.guest}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3 text-slate-500" />
                      {propertyLabel(checkin.propertyId)}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-slate-300 bg-slate-800 px-2 py-1 rounded-md">
                    {whenLabel(checkin.checkIn, checkin.checkInTime)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <h3 className="font-semibold text-white text-sm">Today in Operations</h3>
            <div className="space-y-2">
              {operations.map((op, idx) => (
                <div
                  key={idx}
                  className="text-xs flex items-center gap-2 text-slate-300 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/40"
                >
                  <Clock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>{op.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
