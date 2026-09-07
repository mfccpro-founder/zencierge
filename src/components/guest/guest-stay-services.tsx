import {
  GUEST_STAY_EXTERNAL_LINK_REL,
  GUEST_STAY_EXTERNAL_REFERRER_POLICY,
  GUEST_STAY_SERVICE_CATEGORIES,
  isAllowlistedGuestStayServiceHref,
} from "@/lib/guest-stay-services";

export const GUEST_STAY_SERVICES_BACK_COPY = {
  en: "Use Back to return to Zencierge.",
  es: "Usa Atrás para regresar a Zencierge.",
} as const;

export function GuestStayServices() {
  return (
    <section aria-labelledby="guest-stay-services-heading" className="mt-8 w-full min-w-0">
      <h2 id="guest-stay-services-heading" className="text-sm font-semibold uppercase tracking-wide text-white">
        External service / Servicio externo
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-300">{GUEST_STAY_SERVICES_BACK_COPY.en}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-cyan-200/80">{GUEST_STAY_SERVICES_BACK_COPY.es}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
        {GUEST_STAY_SERVICE_CATEGORIES.map((category) => (
          <article
            key={category.id}
            className="min-w-0 rounded-2xl border border-cyan-400/25 bg-[#0d3258]/85 p-4"
          >
            <h3 className="text-sm font-semibold text-white">{category.label.en}</h3>
            <p className="mt-0.5 text-xs text-cyan-200/80">{category.label.es}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {category.providers.map((provider) => {
                if (!isAllowlistedGuestStayServiceHref(provider.href)) return null;
                return (
                  <li key={provider.id}>
                    <a
                      href={provider.href}
                      target="_self"
                      rel={GUEST_STAY_EXTERNAL_LINK_REL}
                      referrerPolicy={GUEST_STAY_EXTERNAL_REFERRER_POLICY}
                      className="flex min-h-11 items-center justify-center rounded-xl border border-cyan-400/30 bg-[#082238] px-3 py-2 text-sm font-semibold text-cyan-100 outline-none transition hover:border-cyan-300/70 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300"
                    >
                      {provider.name}
                    </a>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
