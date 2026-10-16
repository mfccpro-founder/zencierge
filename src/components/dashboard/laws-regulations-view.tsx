"use client";

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, FileText, Landmark, MapPin, Scale, ShieldAlert } from "lucide-react";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { useListings } from "@/components/dashboard/listings-provider";
import { resolveUsStrJurisdiction, type StrTopic } from "@/lib/us-str-jurisdiction";
import {
  getHostGuideLangServerSnapshot,
  getHostGuideLangSnapshot,
  subscribeHostGuideLang,
} from "@/lib/host-guide-content";
import { LAWS_UI, localizeJurisdiction } from "@/lib/laws-regulations-i18n";

const TOPIC_ICON = {
  zoning: Landmark,
  taxes: FileText,
  platforms: Scale,
  safety: ShieldAlert,
} as const;

function useGuideLanguage() {
  return useSyncExternalStore(
    subscribeHostGuideLang,
    getHostGuideLangSnapshot,
    getHostGuideLangServerSnapshot,
  );
}

export function LawsRegulationsView() {
  const lang = useGuideLanguage();
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">{LAWS_UI[lang].loadingRegulations}</div>}>
      <LawsRegulationsInner />
    </Suspense>
  );
}

function LawsRegulationsInner() {
  const lang = useGuideLanguage();
  const ui = LAWS_UI[lang];
  const { properties, loading } = useListings();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryId = searchParams.get("property");
  const [propertyId, setPropertyId] = useState(queryId ?? "");

  useEffect(() => {
    document.title = ui.browserTitle;
  }, [ui.browserTitle]);

  const selected =
    properties.find((property) => property.id === queryId) ??
    properties.find((property) => property.id === propertyId) ??
    properties[0] ??
    null;
  const jurisdiction = useMemo(() => {
    if (!selected) return null;
    const resolved = resolveUsStrJurisdiction({
      city: selected.city,
      address: selected.address,
      timezone: selected.timezone,
    });
    return resolved ? localizeJurisdiction(resolved, lang) : null;
  }, [selected, lang]);

  function selectProperty(id: string) {
    setPropertyId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("property", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (loading && properties.length === 0) return <p className="text-sm text-slate-500">{ui.loadingProperties}</p>;

  if (!selected) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">{ui.empty}</div>;
  }

  if (!jurisdiction) {
    return (
      <div className="space-y-6" lang={lang}>
        <HostHeroBanner title={ui.title} subtitle={`${selected.name} · ${selected.city}`} />
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <label className="block min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{ui.property}</span>
            <select
              value={selected.id}
              onChange={(event) => selectProperty(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
            >
              {properties.map((property) => (
                <option key={property.id} value={property.id}>{property.name} · {property.city}</option>
              ))}
            </select>
          </label>
          <p className="flex items-start gap-2 text-sm text-slate-700 sm:max-w-md">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
            <span>{selected.address}, {selected.city}</span>
          </p>
        </div>
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-950">
          {ui.unavailableLocation}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" lang={lang}>
      <HostHeroBanner
        title={ui.title}
        subtitle={ui.subtitle(selected.name, jurisdiction.cityLabel, jurisdiction.stateLabel)}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <label className="block min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{ui.property}</span>
          <select
            value={selected.id}
            onChange={(event) => selectProperty(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.name} · {property.city}</option>
            ))}
          </select>
        </label>
        <p className="flex items-start gap-2 text-sm text-slate-700 sm:max-w-md">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          <span>{selected.address}, {selected.city}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
        <p className="font-semibold">{ui.detected}: {jurisdiction.municipality}</p>
        <p className="mt-1 text-sky-900">
          {ui.state} {jurisdiction.stateLabel} ({jurisdiction.stateCode}) · {ui.county} {jurisdiction.county}.{" "}
          {jurisdiction.matchReason}
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-semibold">{ui.disclaimerTitle}</p>
        <p className="mt-1 text-amber-900">{ui.disclaimer}</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">{ui.taxesTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{ui.taxesDescription}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {jurisdiction.taxRates.map((rate) => (
            <div key={rate.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-medium text-slate-600">{rate.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{rate.value}</p>
            </div>
          ))}
        </div>
      </section>

      <nav className="flex flex-wrap gap-2">
        {jurisdiction.topics.map((topic) => (
          <a key={topic.id} href={`#${topic.id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-sky-300 hover:bg-sky-50">
            {topic.title}
          </a>
        ))}
      </nav>

      <div className="grid gap-4">
        {jurisdiction.topics.map((topic) => <TopicSection key={topic.id} topic={topic} />)}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-sky-700" />
          <h2 className="text-sm font-bold text-slate-900">{ui.sources}</h2>
        </div>
        <ul className="mt-3 space-y-2">
          {jurisdiction.links.map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noreferrer" className="text-sm font-medium text-sky-800 hover:underline">{link.label}</a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TopicSection({ topic }: { topic: StrTopic }) {
  const Icon = TOPIC_ICON[topic.id];
  return (
    <section id={topic.id} className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
        <div>
          <h2 className="text-base font-bold text-slate-900">{topic.title}</h2>
          <p className="mt-1 text-sm text-slate-700">{topic.summary}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2 pl-1">
        {topic.bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2 text-sm text-slate-800">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
