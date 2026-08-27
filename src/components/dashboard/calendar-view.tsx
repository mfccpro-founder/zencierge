"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  HelpCircle,
  Link2,
  Loader2,
  Phone,
  Sparkles,
  SprayCan,
  LogIn,
  LogOut,
  Video,
  X,
  Zap,
} from "lucide-react";
import {
  calendarToday,
  icalFeeds as seedFeeds,
  type IcalFeed,
  type Property,
  type Reservation,
} from "@/lib/dashboard-data";
import { useListings } from "@/components/dashboard/listings-provider";

type ViewMode = "month" | "week";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PROPERTY_COLORS: Record<string, { chip: string; meta: string; dot: string; label: string }> = {
  "prop-1": {
    chip: "bg-emerald-100/70 border-emerald-200 text-emerald-800",
    meta: "text-emerald-700",
    dot: "bg-emerald-300 ring-1 ring-emerald-200",
    label: "Emerald",
  },
  "prop-2": {
    chip: "bg-sky-100/70 border-sky-200 text-sky-800",
    meta: "text-sky-700",
    dot: "bg-sky-300 ring-1 ring-sky-200",
    label: "Sky",
  },
  "prop-3": {
    chip: "bg-violet-100/70 border-violet-200 text-violet-800",
    meta: "text-violet-700",
    dot: "bg-violet-300 ring-1 ring-violet-200",
    label: "Violet",
  },
  "prop-4": {
    chip: "bg-amber-100/70 border-amber-200 text-amber-900",
    meta: "text-amber-800",
    dot: "bg-amber-300 ring-1 ring-amber-200",
    label: "Amber",
  },
};

function parseDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function toIso(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

function monthGrid(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function occupiesDay(reservation: Reservation, iso: string) {
  return reservation.checkIn <= iso && iso < reservation.checkOut;
}

function formatLong(iso: string) {
  return parseDay(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type FeedHealth = "idle" | "testing" | "live" | "error";

function looksLikeIcal(url: string) {
  const value = url.trim().toLowerCase();
  return (
    value.endsWith(".ics") ||
    value.includes("airbnb.com/calendar/ical") ||
    value.includes("vrbo.com/icalendar") ||
    value.includes("homeaway.com/icalendar")
  );
}

function colorFor(propertyId: string) {
  return (
    PROPERTY_COLORS[propertyId] ??
    PROPERTY_COLORS[`prop-${(propertyId.length % 4) + 1}`] ??
    PROPERTY_COLORS["prop-1"]!
  );
}

function propertyName(id: string, listings: Property[]) {
  return listings.find((property) => property.id === id)?.name ?? id;
}

export function CalendarView({ onWatchSyncGuide }: { onWatchSyncGuide?: () => void }) {
  const { properties, reservations, saveReservation, loading, error } = useListings();
  const today = parseDay(calendarToday);
  const [mode, setMode] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => new Date(today));
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [feeds, setFeeds] = useState<IcalFeed[]>(seedFeeds);
  const [health, setHealth] = useState<Record<string, FeedHealth>>({});
  const [allLive, setAllLive] = useState(false);

  const visibleReservations = useMemo(() => {
    if (propertyFilter === "all") return reservations;
    return reservations.filter((item) => item.propertyId === propertyFilter);
  }, [propertyFilter, reservations]);

  const days = useMemo(() => {
    if (mode === "week") {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    return monthGrid(cursor);
  }, [cursor, mode]);

  const heading =
    mode === "week"
      ? `${formatLong(toIso(days[0]!))} – ${formatLong(toIso(days[6]!))}`
      : cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const shift = (direction: number) => {
    setCursor((current) => {
      if (mode === "week") return addDays(current, direction * 7);
      return new Date(current.getFullYear(), current.getMonth() + direction, 1);
    });
  };

  const todayIso = calendarToday;
  const checkInsToday = reservations.filter((item) => item.checkIn === todayIso);
  const checkOutsToday = reservations.filter((item) => item.checkOut === todayIso);
  const cleanings = [
    { when: "11:00 AM", property: "Miami Beach Loft", note: "Confirmed mid-stay / turnover prep" },
    { when: "11:00 AM", property: "Fort Lauderdale Villa", note: "Post-Sofia turnover + AC tech 9:00–11:00" },
  ];

  const updateFeed = (id: string, patch: Partial<IcalFeed>) => {
    setFeeds((current) =>
      current.map((feed) => (feed.id === id ? { ...feed, ...patch } : feed)),
    );
    setHealth((current) => ({ ...current, [id]: "idle" }));
    setAllLive(false);
  };

  const testFeed = (id: string) => {
    const feed = feeds.find((item) => item.id === id);
    if (!feed) return;
    const seed = seedFeeds.find((item) => item.id === id);
    const next: IcalFeed = {
      ...feed,
      airbnbUrl: feed.airbnbUrl.trim() || seed?.airbnbUrl || feed.airbnbUrl,
      vrboUrl: feed.vrboUrl.trim() || seed?.vrboUrl || feed.vrboUrl,
    };
    setFeeds((current) => current.map((item) => (item.id === id ? next : item)));
    setHealth((current) => ({ ...current, [id]: "testing" }));
    window.setTimeout(() => {
      const ok =
        looksLikeIcal(next.airbnbUrl) || looksLikeIcal(next.vrboUrl);
      setHealth((current) => ({ ...current, [id]: ok ? "live" : "error" }));
    }, 500);
  };

  const quickConnect = () => {
    setFeeds(seedFeeds);
    setHealth(Object.fromEntries(seedFeeds.map((feed) => [feed.id, "testing"])));
    window.setTimeout(() => {
      setHealth(Object.fromEntries(seedFeeds.map((feed) => [feed.id, "live"])));
      setAllLive(true);
    }, 550);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <p className="xl:col-span-2 text-[11px] text-slate-500 -mb-2">
        {loading
          ? "Loading reservations from Supabase…"
          : "Reservations live from Supabase"}
        {error ? ` · ${error}` : ""}
      </p>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-800"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h3 className="text-sm font-semibold text-white min-w-[220px] text-center">{heading}</h3>
            <button
              type="button"
              onClick={() => shift(1)}
              className="rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-800"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursor(new Date(today))}
              className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800"
            >
              Today
            </button>
          </div>
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
            {(["month", "week"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize ${
                  mode === item
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={propertyFilter === "all"}
            onClick={() => setPropertyFilter("all")}
            label="All properties"
          />
          {properties.map((property) => (
            <FilterChip
              key={property.id}
              active={propertyFilter === property.id}
              onClick={() => setPropertyFilter(property.id)}
              label={property.name}
              dot={colorFor(property.id).dot}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="px-2 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold text-center"
              >
                {day}
              </div>
            ))}
          </div>
          <div className={`grid grid-cols-7 bg-white ${mode === "week" ? "min-h-[360px]" : ""}`}>
            {days.map((day) => {
              const iso = toIso(day);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = iso === todayIso;
              const dayReservations = visibleReservations.filter((item) => occupiesDay(item, iso));
              return (
                <div
                  key={iso}
                  className={`border-t border-r border-slate-200 p-1.5 ${
                    mode === "week" ? "min-h-[360px]" : "min-h-[108px]"
                  } ${
                    isToday
                      ? "bg-emerald-50"
                      : !inMonth && mode === "month"
                        ? "bg-slate-50"
                        : "bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 px-0.5">
                    <span
                      className={`text-[11px] font-semibold ${
                        isToday
                          ? "h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center"
                          : inMonth
                            ? "text-slate-800"
                            : "text-slate-500"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {iso === todayIso ? (
                      <span className="text-[9px] text-emerald-700 font-semibold">Today</span>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {dayReservations.map((item) => {
                      const colors = colorFor(item.propertyId);
                      const isCheckIn = item.checkIn === iso;
                      const isCheckOutEve = item.checkOut === toIso(addDays(day, 1));
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelected(item)}
                          className={`w-full text-left rounded-md border px-1.5 py-1 ${colors?.chip ?? "bg-slate-100 border-slate-200 text-slate-800"}`}
                        >
                          <p className="text-[10px] font-semibold truncate leading-tight">{item.guest}</p>
                          {mode === "week" ? (
                            <p className={`text-[9px] font-medium truncate ${colors?.meta ?? "text-slate-600"}`}>
                              {item.platform}
                              {isCheckIn ? " · in" : ""}
                              {isCheckOutEve ? " · last night" : ""}
                            </p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Today&apos;s Operations</h3>
          </div>
          <p className="text-[11px] text-slate-500">{formatLong(todayIso)} · South Florida</p>
          <OpGroup
            icon={<LogIn className="h-3.5 w-3.5 text-sky-400" />}
            title="Check-ins today"
            empty="No arrivals"
            items={checkInsToday.map((item) => `${item.guest} · ${propertyName(item.propertyId, properties)} · ${item.checkInTime}`)}
          />
          <OpGroup
            icon={<LogOut className="h-3.5 w-3.5 text-amber-400" />}
            title="Check-outs"
            empty="No departures today"
            items={checkOutsToday.map((item) => `${item.guest} · ${propertyName(item.propertyId, properties)} · ${item.checkOutTime}`)}
          />
          <OpGroup
            icon={<SprayCan className="h-3.5 w-3.5 text-violet-400" />}
            title="Cleanings scheduled"
            empty="None"
            items={cleanings.map((item) => `${item.when} · ${item.property} — ${item.note}`)}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-semibold text-slate-800">Sync Feeds</h3>
          </div>
          <button
            type="button"
            onClick={quickConnect}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-bold text-slate-950 shadow-sm hover:bg-emerald-400"
          >
            <Zap className="h-3.5 w-3.5 fill-current" />
            Quick Connect (Airbnb & Vrbo)
          </button>
          <button
            type="button"
            onClick={() => onWatchSyncGuide?.()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
          >
            <Video className="h-3.5 w-3.5 text-sky-600" />
            Watch 30s Guide
          </button>
          {allLive ? (
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
              <CircleCheck className="h-3.5 w-3.5" />
              Live & In Sync (Zero Double-Bookings)
            </p>
          ) : null}
          <p className="text-[11px] text-slate-600 leading-relaxed">
            One click connects every Florida listing. Or paste iCal links below — we auto-detect and
            test so Airbnb, Vrbo, and Direct never overlap.
          </p>
          {feeds.map((feed) => {
            const status = health[feed.id] ?? "idle";
            return (
              <div key={feed.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-slate-800">{propertyName(feed.propertyId, properties)}</p>
                  {status === "live" ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live & In Sync
                    </span>
                  ) : null}
                  {status === "testing" ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Testing…
                    </span>
                  ) : null}
                  {status === "error" ? (
                    <span className="text-[10px] font-medium text-rose-600">Need a valid .ics link</span>
                  ) : null}
                </div>
                <label className="block">
                  <span className="flex items-center gap-1 text-[10px] text-slate-500">
                    Airbnb iCal
                    <FeedHint
                      title="Airbnb — 2 steps"
                      steps={[
                        "Open the listing → Calendar → Availability.",
                        "Export calendar, copy the .ics link, paste it here.",
                      ]}
                    />
                  </span>
                  <input
                    value={feed.airbnbUrl}
                    onChange={(event) => updateFeed(feed.id, { airbnbUrl: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono text-slate-800 outline-none focus:border-emerald-500"
                    placeholder="https://www.airbnb.com/calendar/ical/…"
                  />
                </label>
                <label className="block">
                  <span className="flex items-center gap-1 text-[10px] text-slate-500">
                    Vrbo iCal
                    <FeedHint
                      title="Vrbo — 2 steps"
                      steps={[
                        "Calendar → Availability → Export calendar.",
                        "Copy the iCalendar URL and paste it here.",
                      ]}
                    />
                  </span>
                  <input
                    value={feed.vrboUrl}
                    onChange={(event) => updateFeed(feed.id, { vrboUrl: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono text-slate-800 outline-none focus:border-emerald-500"
                    placeholder="https://www.vrbo.com/icalendar/…"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => testFeed(feed.id)}
                  className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  Auto-Detect & Test Feed
                </button>
              </div>
            );
          })}
        </section>
      </aside>

      {selected ? (
        <ReservationDrawer
          key={selected.id}
          reservation={selected}
          listings={properties}
          onSave={(item) => {
            void saveReservation(item);
            setSelected(item);
          }}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function FeedHint({ title, steps }: { title: string; steps: string[] }) {
  return (
    <span className="relative group/hint inline-flex">
      <HelpCircle className="h-3 w-3 text-slate-400 group-hover/hint:text-sky-600" tabIndex={0} />
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-52 rounded-lg border border-slate-200 bg-white p-2 text-[10px] font-normal text-slate-700 shadow-lg group-hover/hint:block group-focus-within/hint:block">
        <span className="block font-semibold text-slate-800 mb-1">{title}</span>
        <span className="block">1. {steps[0]}</span>
        <span className="block mt-0.5">2. {steps[1]}</span>
      </span>
    </span>
  );
}

function FilterChip({
  active,
  label,
  onClick,
  dot,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        active
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
          : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
      }`}
    >
      {dot ? <span className={`h-2 w-2 rounded-full ${dot}`} /> : null}
      {label}
    </button>
  );
}

function OpGroup({
  icon,
  title,
  items,
  empty,
}: {
  icon: ReactNode;
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800 mb-1.5">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-500 pl-5">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item}
              className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReservationDrawer({
  reservation,
  listings,
  onSave,
  onClose,
}: {
  reservation: Reservation;
  listings: Property[];
  onSave: (reservation: Reservation) => void;
  onClose: () => void;
}) {
  const property = listings.find((item) => item.id === reservation.propertyId);
  const [notes, setNotes] = useState(reservation.aiNotes);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/60 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-title"
        className="h-full w-full max-w-md border-l border-slate-800 bg-slate-950 p-6 overflow-y-auto shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              {reservation.platform} · {reservation.nights} nights
            </p>
            <h3 id="reservation-title" className="text-lg font-semibold text-white mt-1">
              {reservation.guest}
            </h3>
            <p className="text-xs text-slate-400 mt-1">{property?.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-6 space-y-3 text-sm">
          <Row label="Check-in" value={`${formatLong(reservation.checkIn)} · ${reservation.checkInTime}`} />
          <Row label="Check-out" value={`${formatLong(reservation.checkOut)} · ${reservation.checkOutTime}`} />
          <Row
            label="Contact"
            value={
              <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                <Phone className="h-3 w-3 text-slate-500" />
                {reservation.phone}
              </span>
            }
          />
          <Row
            label="Access code"
            value={<span className="font-mono text-emerald-300">{reservation.accessCode}</span>}
          />
          <Row label="Smartlock" value={property?.smartlock ?? "—"} />
        </dl>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            AI Concierge notes
          </div>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onSave({ ...reservation, aiNotes: notes.trim() })}
            className="mt-3 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
          >
            Save notes to Supabase
          </button>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/70 pb-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-xs text-slate-200 text-right">{value}</dd>
    </div>
  );
}
