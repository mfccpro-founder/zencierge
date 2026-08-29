"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Fingerprint,
  Shield,
  FileSearch,
  ClipboardCheck,
  Lightbulb,
  Sparkles,
  BookOpen,
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
import { isDevPreviewUser, readPendingSignup } from "@/lib/pending-signup";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { useFeatureRequest } from "@/components/dashboard/feature-request-widget";
import { dashboardTabFromPath, isDashboardNavActive } from "@/lib/dashboard-nav";
import { InteractiveConciergeTour } from "@/components/InteractiveConciergeTour";
import { HousekeepingStaffLinkCard } from "@/components/dashboard/housekeeping-staff-link-card";

const commandLinks: {
  href: string;
  label: string;
  icon: LucideIcon;
  match: "exact" | "prefix";
  id: NavId;
}[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, match: "exact", id: "overview" },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays, match: "prefix", id: "calendar" },
  { href: "/dashboard/financials", label: "Financials", icon: Banknote, match: "prefix", id: "finances" },
  { href: "/dashboard/voice-agent", label: "Voice Concierge", icon: Headphones, match: "prefix", id: "voice" },
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
    title: "Host Settings Hub",
    subtitle: "Profile, alerts, hardware, and team access",
  },
};

const hostOpsLinks: { href: string; label: string; icon: LucideIcon; match: "exact" | "prefix" }[] = [
  { href: "/dashboard/properties", label: "Properties & Elena AI", icon: Sparkles, match: "prefix" },
  { href: "/dashboard/guest-dna", label: "Guest DNA & Direct Leads", icon: Fingerprint, match: "prefix" },
  { href: "/dashboard/neighbor-shield", label: "NeighborShield", icon: Shield, match: "prefix" },
  { href: "/dashboard/dispute-dossier", label: "Dispute Dossier", icon: FileSearch, match: "prefix" },
  { href: "/dashboard/housekeeping", label: "Housekeeping / Inspections", icon: ClipboardCheck, match: "prefix" },
];

export function DashboardApp(_props: { initialTab?: NavId } = {}) {
  const pathname = usePathname() || "/dashboard";
  const router = useRouter();
  const { open: openFeatureRequest } = useFeatureRequest();
  const activeTab = dashboardTabFromPath(pathname);
  const [selectedCall, setSelectedCall] = useState<Call | null>(calls[0]);
  const avatarGuideRef = useRef<AiAvatarGuideHandle>(null);
  const [hostName, setHostName] = useState("Host");
  const [welcomeBack, setWelcomeBack] = useState(false);
  const meta = pageMeta[activeTab];
  const showPageHeader = activeTab !== "voice";

  useEffect(() => {
    const applyIdentity = (user: { email?: string | null; user_metadata?: Record<string, unknown> } | null) => {
      const pending = readPendingSignup();
      const mock = isDevPreviewUser(user);
      if (pending) {
        setHostName(pending.fullName.split(/\s+/)[0] || "Host");
        setWelcomeBack(Boolean(user?.email && !mock && (user.email ?? "").toLowerCase() === pending.email.toLowerCase()));
        return;
      }
      setHostName(hostDisplayName(user));
      setWelcomeBack(Boolean(user?.email && !mock));
    };

    try {
      const supabase = createAuthBrowserClient();
      void supabase.auth.getUser().then(({ data }: { data: { user: { email?: string | null; user_metadata?: Record<string, unknown> } | null } }) => {
        applyIdentity(data.user);
      });
      const { data: subscription } = supabase.auth.onAuthStateChange((_event: string, session: { user: { email?: string | null; user_metadata?: Record<string, unknown> } | null } | null) => {
        applyIdentity(session?.user ?? null);
      });
      return () => subscription.subscription.unsubscribe();
    } catch {
      applyIdentity(null);
    }
  }, []);

  return (
    <div className="flex h-[calc(100vh-4.75rem)] min-h-0 bg-slate-50 text-slate-900">
      <aside className="z-40 flex h-full w-64 shrink-0 flex-col justify-between overflow-y-auto border-r border-indigo-950/40 bg-slate-800 p-4">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-lg font-bold text-white">
              Z
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">Zencierge</h1>
              <p className="text-xs text-slate-200">Host OS · Florida</p>
            </div>
          </div>

          <nav className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-200">Host operations</p>
            {hostOpsLinks.map((item) => {
              const Icon = item.icon;
              const active = isDashboardNavActive(pathname, item.href, item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    active
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-200 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-indigo-800" : "text-slate-200"}`} />
                  {item.label}
                </Link>
              );
            })}
            <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-200">Command center</p>
            {commandLinks.map((item) => {
              const Icon = item.icon;
              const isActive = isDashboardNavActive(pathname, item.href, item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tour={item.id === "voice" ? "voice" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-200 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? "text-indigo-800" : "text-slate-200"}`} />
                  {item.label}
                  {item.id === "voice" ? (
                    <span className="ml-auto rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-900">
                      Avatar
                    </span>
                  ) : null}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={openFeatureRequest}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:bg-white/10 hover:text-white"
            >
              <Lightbulb className="h-4 w-4 text-slate-200" />
              Request a Feature
            </button>
            <Link
              href="/dashboard/guide"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                pathname === "/dashboard/guide" || pathname.startsWith("/dashboard/guide/")
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-200 hover:bg-white/10 hover:text-white"
              }`}
            >
              <BookOpen
                className={`h-4 w-4 ${
                  pathname === "/dashboard/guide" || pathname.startsWith("/dashboard/guide/")
                    ? "text-indigo-800"
                    : "text-slate-200"
                }`}
              />
              User Guide & Docs
            </Link>
            <Link
              href="/dashboard/settings"
              aria-current={
                isDashboardNavActive(pathname, "/dashboard/settings", "prefix") ? "page" : undefined
              }
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                isDashboardNavActive(pathname, "/dashboard/settings", "prefix")
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-200 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Settings
                className={`h-4 w-4 ${
                  isDashboardNavActive(pathname, "/dashboard/settings", "prefix")
                    ? "text-indigo-800"
                    : "text-slate-200"
                }`}
              />
              Settings
            </Link>
          </nav>
        </div>

        <div>
          <div className="flex items-center justify-between rounded-xl border border-white/15 bg-white/10 p-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
              </span>
              <span className="text-xs font-medium text-slate-200">Voice Line Active</span>
            </div>
            <span className="rounded-md bg-white px-2 py-0.5 font-mono text-[10px] font-medium text-slate-900">
              +1 (305) 555-0199
            </span>
          </div>
          <HostSignOutButton className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-[11px] font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-60" />
        </div>
      </aside>

      <main className="relative z-0 min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto p-6 lg:p-8">
        <InteractiveConciergeTour />
        <HostHeroBanner
          title={welcomeBack ? `Welcome back, ${hostName}` : `Welcome, ${hostName}`}
          subtitle={showPageHeader ? `${meta.title} · ${meta.subtitle}` : "Host Command Center | Zencierge"}
        >
          <StatusChrome
            onOpenReceptionist={() => router.push("/dashboard/voice-agent")}
            onOpenTutorial={() => avatarGuideRef.current?.openTutorial()}
          />
        </HostHeroBanner>

        <div key={activeTab} className="view-enter">
          {activeTab === "overview" ? (
            <OverviewPanel selectedCall={selectedCall} setSelectedCall={setSelectedCall} />
          ) : null}
          {activeTab === "properties" ? (
            <div className="space-y-10">
              <PropertiesView />
              <VoiceConciergeView />
            </div>
          ) : null}
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
        onTestVoiceCall={() => router.push("/dashboard/voice-agent")}
        onStartSetup={() => router.push("/dashboard/properties")}
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
        className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-100"
      >
        🎓 Video Guide / Tutorial
      </button>
      <button
        type="button"
        onClick={() => {
          onOpenReceptionist();
          window.requestAnimationFrame(() => {
            document.getElementById("ai-receptionist")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
        className="flex items-center gap-2 rounded-full bg-white py-1 pl-1.5 pr-3 text-xs font-medium text-slate-900 hover:bg-slate-100"
      >
        <ReceptionistAvatar phase="idle" size="sm" name="Elena" />
        AI Receptionist Ready
      </button>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-900">
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
      <HousekeepingStaffLinkCard />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-700">
              Monthly Earnings
            </span>
            <Banknote className="h-4 w-4 text-indigo-700" />
          </div>
          <div className="mt-3 text-3xl font-extrabold text-slate-900">{metrics.monthlyEarnings}</div>
          <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-800">
            <TrendingUp className="h-3.5 w-3.5" />
            {metrics.earningsTrend}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-700">
              Occupancy Rate
            </span>
            <Building2 className="h-4 w-4 text-sky-700" />
          </div>
          <div className="mt-3 text-3xl font-extrabold text-slate-900">{metrics.occupancyRate}</div>
          <div className="mt-2 text-xs text-slate-700">{metrics.occupancyDays}</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-700">
              Upcoming Check-ins
            </span>
            <CalendarDays className="h-4 w-4 text-indigo-700" />
          </div>
          <div className="mt-3 text-3xl font-extrabold text-slate-900">{upcoming.length}</div>
          <div className="mt-2 text-xs text-slate-700">{metrics.checkInsSubtitle}</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-700">
              Phone Assistant
            </span>
            <Headphones className="h-4 w-4 text-indigo-700" />
          </div>
          <div className="mt-3 flex items-center gap-2 text-3xl font-extrabold text-slate-900">
            <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-500"></span>
            {metrics.phoneAssistantStatus}
          </div>
          <div className="mt-2 text-xs text-slate-700">{metrics.phoneAssistantSub}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-indigo-700" />
              <h3 className="text-base font-semibold text-slate-900">Recent Voice Concierge Calls</h3>
            </div>
            <Link href="/dashboard/voice-agent" className="text-xs font-medium text-indigo-800 hover:underline">
              View voice inbox
            </Link>
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
                      ? "border-indigo-300 bg-indigo-50 shadow-md"
                      : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-indigo-800">
                        <Headphones className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{call.guest}</span>
                          <span className="text-xs text-slate-700">· {call.property}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-700">{call.summary}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-slate-700">{call.time}</span>
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
                    <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 pt-4">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
                        Call Transcript
                      </span>
                      {call.transcript.map((line, idx) => (
                        <div key={idx} className="flex gap-2 text-xs">
                          <span
                            className={`min-w-[70px] font-semibold capitalize ${
                              line.speaker === "ai" ? "text-indigo-800" : "text-slate-900"
                            }`}
                          >
                            {line.speaker === "ai" ? "Zencierge:" : `${line.speaker}:`}
                          </span>
                          <span className="text-slate-800">{line.text}</span>
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
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Upcoming Check-ins</h3>
            <div className="space-y-3">
              {upcoming.length === 0 ? (
                <p className="text-xs text-slate-700">No upcoming stays in listings.</p>
              ) : null}
              {upcoming.map((checkin) => (
                <div
                  key={checkin.id}
                  className="flex items-center justify-between border-b border-slate-200 pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">{checkin.guest}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-700">
                      <MapPin className="h-3 w-3 text-indigo-700" />
                      {propertyLabel(checkin.propertyId)}
                    </div>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-900">
                    {whenLabel(checkin.checkIn, checkin.checkInTime)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Today in Operations</h3>
            <div className="space-y-2">
              {operations.map((op, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 text-indigo-700" />
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
