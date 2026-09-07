export const GUEST_STAY_EXTERNAL_LINK_REL = "noopener noreferrer" as const;
export const GUEST_STAY_EXTERNAL_REFERRER_POLICY = "no-referrer" as const;

export type GuestStayServiceId =
  | "transportation"
  | "food-delivery"
  | "groceries"
  | "dining"
  | "tours"
  | "rental-cars"
  | "maps-local-guide"
  | "luggage"
  | "baby-gear";

export type GuestStayServiceProvider = {
  readonly id: string;
  readonly name: string;
  readonly href: string;
};

export type GuestStayServiceCategory = {
  readonly id: GuestStayServiceId;
  readonly label: { readonly en: string; readonly es: string };
  readonly providers: readonly GuestStayServiceProvider[];
};

export const GUEST_STAY_SERVICE_CATEGORIES: readonly GuestStayServiceCategory[] = Object.freeze([
  Object.freeze({
    id: "transportation",
    label: Object.freeze({ en: "Transportation", es: "Transporte" }),
    providers: Object.freeze([
      Object.freeze({ id: "uber", name: "Uber", href: "https://www.uber.com/" }),
      Object.freeze({ id: "lyft", name: "Lyft", href: "https://www.lyft.com/" }),
    ]),
  }),
  Object.freeze({
    id: "food-delivery",
    label: Object.freeze({ en: "Food delivery", es: "Entrega de comida" }),
    providers: Object.freeze([
      Object.freeze({ id: "doordash", name: "DoorDash", href: "https://www.doordash.com/" }),
      Object.freeze({ id: "uber-eats", name: "Uber Eats", href: "https://www.ubereats.com/" }),
    ]),
  }),
  Object.freeze({
    id: "groceries",
    label: Object.freeze({ en: "Groceries", es: "Supermercado" }),
    providers: Object.freeze([
      Object.freeze({ id: "instacart", name: "Instacart", href: "https://www.instacart.com/" }),
    ]),
  }),
  Object.freeze({
    id: "dining",
    label: Object.freeze({ en: "Dining reservations", es: "Reservas de restaurantes" }),
    providers: Object.freeze([
      Object.freeze({ id: "opentable", name: "OpenTable", href: "https://www.opentable.com/" }),
      Object.freeze({ id: "resy", name: "Resy", href: "https://resy.com/" }),
    ]),
  }),
  Object.freeze({
    id: "tours",
    label: Object.freeze({ en: "Tours and attractions", es: "Tours y atracciones" }),
    providers: Object.freeze([
      Object.freeze({ id: "big-bus-tours", name: "Big Bus Tours", href: "https://www.bigbustours.com/" }),
    ]),
  }),
  Object.freeze({
    id: "rental-cars",
    label: Object.freeze({ en: "Rental cars", es: "Alquiler de autos" }),
    providers: Object.freeze([
      Object.freeze({ id: "enterprise", name: "Enterprise", href: "https://www.enterprise.com/" }),
      Object.freeze({ id: "hertz", name: "Hertz", href: "https://www.hertz.com/" }),
    ]),
  }),
  Object.freeze({
    id: "maps-local-guide",
    label: Object.freeze({ en: "Maps and local guide", es: "Mapas y guía local" }),
    providers: Object.freeze([
      Object.freeze({ id: "google-maps", name: "Google Maps", href: "https://www.google.com/maps" }),
    ]),
  }),
  Object.freeze({
    id: "luggage",
    label: Object.freeze({ en: "Luggage", es: "Equipaje" }),
    providers: Object.freeze([
      Object.freeze({ id: "bounce", name: "Bounce", href: "https://usebounce.com/" }),
    ]),
  }),
  Object.freeze({
    id: "baby-gear",
    label: Object.freeze({ en: "Baby gear", es: "Artículos para bebés" }),
    providers: Object.freeze([
      Object.freeze({ id: "babyquip", name: "BabyQuip", href: "https://www.babyquip.com/" }),
    ]),
  }),
]);

const FORBIDDEN_HREF = /token|stayid|stay_id|propertyid|property_id|address|password|username/i;

export function isExactHttpsHomepage(href: string): boolean {
  if (typeof href !== "string" || href.includes("?") || href.includes("#") || href.includes("@")) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.search !== "" || parsed.hash !== "") return false;
  if (FORBIDDEN_HREF.test(href)) return false;
  return parsed.toString() === href;
}

export function allowlistedGuestStayServiceHrefs(): readonly string[] {
  return GUEST_STAY_SERVICE_CATEGORIES.flatMap((category) => category.providers.map((provider) => provider.href));
}

export function isAllowlistedGuestStayServiceHref(href: string): boolean {
  return allowlistedGuestStayServiceHrefs().includes(href) && isExactHttpsHomepage(href);
}
