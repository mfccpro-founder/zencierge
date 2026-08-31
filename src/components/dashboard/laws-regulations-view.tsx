"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, FileText, Landmark, MapPin, Scale, ShieldAlert } from "lucide-react";
import { HostHeroBanner } from "@/components/dashboard/host-hero-banner";
import { useListings } from "@/components/dashboard/listings-provider";
import { resolveUsStrJurisdiction, type StrTopic } from "@/lib/us-str-jurisdiction";

const TOPIC_ICON = {
  zoning: Landmark,
  taxes: FileText,
  platforms: Scale,
  safety: ShieldAlert,
} as const;

export function LawsRegulationsView() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Cargando regulaciones…</div>}>
      <LawsRegulationsInner />
    </Suspense>
  );
}

function LawsRegulationsInner() {
  const { properties, loading } = useListings();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryId = searchParams.get("property");
  const [propertyId, setPropertyId] = useState(queryId ?? "");

  useEffect(() => {
    if (queryId && properties.some((property) => property.id === queryId)) {
      setPropertyId(queryId);
      return;
    }
    if (!propertyId && properties[0]) {
      setPropertyId(properties[0].id);
    }
  }, [queryId, properties, propertyId]);

  const selected =
    properties.find((property) => property.id === propertyId) ?? properties[0] ?? null;

  const jurisdiction = useMemo(
    () =>
      selected
        ? resolveUsStrJurisdiction({
            city: selected.city,
            address: selected.address,
            timezone: selected.timezone,
          })
        : null,
    [selected],
  );

  function selectProperty(id: string) {
    setPropertyId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("property", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (loading && properties.length === 0) {
    return <p className="text-sm text-slate-500">Cargando propiedades…</p>;
  }

  if (!selected || !jurisdiction) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
        No hay propiedades en el portafolio. Añade un listing con ciudad y dirección para ver las reglas locales.
      </div>
    );
  }

  return (
    <div className="space-y-6" lang="es">
      <HostHeroBanner
        title="Leyes y regulaciones de Airbnb"
        subtitle={`${selected.name} · ${jurisdiction.cityLabel}, ${jurisdiction.stateLabel}. Zonificación, impuestos y registro para esta dirección.`}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <label className="block min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Propiedad
          </span>
          <select
            value={selected.id}
            onChange={(event) => selectProperty(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name} · {property.city}
              </option>
            ))}
          </select>
        </label>
        <p className="flex items-start gap-2 text-sm text-slate-700 sm:max-w-md">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          <span>
            {selected.address}, {selected.city}
          </span>
        </p>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
        <p className="font-semibold">
          Ubicación detectada: {jurisdiction.municipality}
        </p>
        <p className="mt-1 text-sky-900">
          Estado {jurisdiction.stateLabel} ({jurisdiction.stateCode}) · Condado {jurisdiction.county}.{" "}
          {jurisdiction.matchReason}
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-semibold">Esto es una guía operativa, no asesoría legal.</p>
        <p className="mt-1 text-amber-900">
          Las ordenanzas y las tasas cambian. Confirma con tu ciudad, condado, HOA y un abogado o contador
          del estado correspondiente antes de publicar o modificar esta unidad. Zencierge no presenta impuestos ni tramita licencias
          por ti. Las tasas de la tabla son de referencia y deben verificarse.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Requisitos fiscales de referencia</h2>
        <p className="mt-1 text-sm text-slate-600">
          Combinación habitual para alquileres de menos de seis meses en esta jurisdicción. Airbnb o Vrbo pueden
          recaudar solo una parte.
        </p>
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
          <a
            key={topic.id}
            href={`#${topic.id}`}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-sky-300 hover:bg-sky-50"
          >
            {topic.title}
          </a>
        ))}
      </nav>

      <div className="grid gap-4">
        {jurisdiction.topics.map((topic) => (
          <TopicSection key={topic.id} topic={topic} />
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-sky-700" />
          <h2 className="text-sm font-bold text-slate-900">Fuentes oficiales para esta ubicación</h2>
        </div>
        <ul className="mt-3 space-y-2">
          {jurisdiction.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-sky-800 hover:underline"
              >
                {link.label}
              </a>
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
