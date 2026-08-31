"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Banknote,
  Building2,
  CalendarDays,
  Headphones,
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
  type Call,
} from "@/lib/dashboard-data";
import { useListings } from "@/components/dashboard/listings-provider";
import { PropertiesView } from "@/components/dashboard/properties-view";
import { CalendarView } from "@/components/dashboard/calendar-view";
import { FinancesView } from "@/components/dashboard/finances-view";
import { SettingsView } from "@/components/dashboard/settings-view";
import { AiAvatarGuide, type AiAvatarGuideHandle } from "@/components/dashboard/ai-avatar-guide";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { dashboardTabFromPath } from "@/lib/dashboard-nav";
import type { NavId } from "@/lib/dashboard-data";

const pageMeta: Record<NavId, { title: string; subtitle: string }> = {
  overview: {
    title: "Dashboard",
    subtitle: "Live operations across your Florida listings",
  },
  properties: {
    title: "Properties and Smart Locks",
    subtitle: "Door codes, occupancy, handbooks, and Seam locks",
  },
  calendar: {
    title: "Calendar",
    subtitle: "Reservations and turnover windows",
  },
  finances: {
    title: "Financials",
    subtitle: "Net profit, ADR, occupancy, and payouts",
  },
  voice: {
    title: "Elena Voice Concierge",
    subtitle: "AI receptionist and guest QR cards",
  },
  settings: {
    title: "Settings & subscription",
    subtitle: "Profile, alerts, Square billing, and team access",
  },
};

export function DashboardApp(_props: { initialTab?: NavId } = {}) {
  const pathname = usePathname() || "/dashboard";
  const router = useRouter();
  const activeTab = dashboardTabFromPath(pathname);
  const [selectedCall, setSelectedCall] = useState<Call | null>(calls[0]);
  const avatarGuideRef = useRef<AiAvatarGuideHandle>(null);
  const meta = pageMeta[activeTab];

  const lockView = activeTab === "finances";

  return (
    <div
      className={
        lockView
          ? "flex h-[calc(100dvh-8rem)] max-h-[calc(100dvh-8rem)] flex-col overflow-hidden"
          : "space-y-6"
      }
    >
      <div className="shrink-0">
        <HostHeroBanner title={meta.title} subtitle={meta.subtitle} />
      </div>

      <div key={activeTab} className={lockView ? "view-enter min-h-0 flex-1 overflow-hidden" : "view-enter"}>
        {activeTab === "overview" ? (
          <OverviewPanel selectedCall={selectedCall} setSelectedCall={setSelectedCall} />
        ) : null}
        {activeTab === "properties" ? <PropertiesView /> : null}
        {activeTab === "calendar" ? (
          <CalendarView onWatchSyncGuide={() => avatarGuideRef.current?.openCalendarSync()} />
        ) : null}
        {activeTab === "finances" ? <FinancesView /> : null}
        {activeTab === "settings" ? <SettingsView /> : null}
      </div>
      <AiAvatarGuide
        ref={avatarGuideRef}
        onTestVoiceCall={() => router.push("/dashboard/voice-agent")}
        onStartSetup={() => router.push("/dashboard/properties")}
      />
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
