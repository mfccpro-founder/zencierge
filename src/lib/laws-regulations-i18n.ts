import type { GuideLang } from "@/lib/host-guide-content";
import type { StrJurisdiction, StrTopic } from "@/lib/us-str-jurisdiction";

export const LAWS_UI = {
  en: {
    loadingRegulations: "Loading regulations…",
    loadingProperties: "Loading properties…",
    empty: "There are no properties in the portfolio. Add a listing with a city and address to view local rules.",
    unavailableLocation: "Regulatory information is not available for this location.",
    title: "Airbnb Regulations & Laws",
    subtitle: (name: string, city: string, state: string) =>
      `${name} · ${city}, ${state}. Zoning, taxes, and registration for this address.`,
    property: "Property",
    detected: "Location detected",
    state: "State",
    county: "County",
    disclaimerTitle: "This is an operational guide, not legal advice.",
    disclaimer:
      "Ordinances and rates change. Confirm with your city, county, HOA, and an attorney or accountant in the applicable state before listing or changing this unit. Zencierge does not file taxes or obtain licenses for you. The rates in the table are references and must be verified.",
    taxesTitle: "Reference tax requirements",
    taxesDescription:
      "Typical combination for rentals shorter than six months in this jurisdiction. Airbnb or Vrbo may collect only part of it.",
    sources: "Official sources for this location",
    browserTitle: "Airbnb Regulations & Laws · Zencierge",
  },
  es: {
    loadingRegulations: "Cargando regulaciones…",
    loadingProperties: "Cargando propiedades…",
    empty: "No hay propiedades en el portafolio. Añade un listing con ciudad y dirección para ver las reglas locales.",
    unavailableLocation: "Información normativa no disponible para esta ubicación",
    title: "Regulaciones y leyes de Airbnb",
    subtitle: (name: string, city: string, state: string) =>
      `${name} · ${city}, ${state}. Zonificación, impuestos y registro para esta dirección.`,
    property: "Propiedad",
    detected: "Ubicación detectada",
    state: "Estado",
    county: "Condado",
    disclaimerTitle: "Esto es una guía operativa, no asesoría legal.",
    disclaimer:
      "Las ordenanzas y las tasas cambian. Confirma con tu ciudad, condado, HOA y un abogado o contador del estado correspondiente antes de publicar o modificar esta unidad. Zencierge no presenta impuestos ni tramita licencias por ti. Las tasas de la tabla son de referencia y deben verificarse.",
    taxesTitle: "Requisitos fiscales de referencia",
    taxesDescription:
      "Combinación habitual para alquileres de menos de seis meses en esta jurisdicción. Airbnb o Vrbo pueden recaudar solo una parte.",
    sources: "Fuentes oficiales para esta ubicación",
    browserTitle: "Regulaciones y leyes de Airbnb · Zencierge",
  },
} as const;

const TAX_LABELS: Record<string, string> = {
  "Impuesto de ventas de Florida": "Florida sales tax",
  "Impuesto de ventas de Florida (base)": "Florida sales tax (base)",
  "Recargo discrecional (Miami-Dade)": "Discretionary surtax (Miami-Dade)",
  "Recargo discrecional (Broward)": "Discretionary surtax (Broward)",
  "Recargo discrecional (Palm Beach)": "Discretionary surtax (Palm Beach)",
  "TDT del condado Miami-Dade": "Miami-Dade County TDT",
  "TDT del condado Broward": "Broward County TDT",
  "TDT del condado Palm Beach": "Palm Beach County TDT",
  "Impuesto de hospedaje / resort de Miami Beach": "Miami Beach resort / lodging tax",
  "TDT / recargo local": "TDT / local surtax",
  "Impuesto estatal de hospedaje (Texas)": "Texas state hotel occupancy tax",
  "Impuesto municipal / de condado": "Municipal / county tax",
  "Ventas (si aplica a extras)": "Sales tax (if applicable to extras)",
  "Transient occupancy tax (TOT) municipal": "Municipal transient occupancy tax (TOT)",
  "Impuesto de ventas de California": "California sales tax",
  "Impuesto estatal / occupancy": "State / occupancy tax",
  "Impuesto de ciudad o condado": "City or county tax",
};

const VALUE_LABELS: Record<string, string> = {
  "Según condado": "Depends on county",
  "Según ciudad": "Depends on city",
  "Según distrito": "Depends on district",
  "Según jurisdicción": "Depends on jurisdiction",
  "Hasta ~7% local": "Up to ~7% local",
};

const LINK_LABELS: Record<string, string> = {
  "Departamento de Ingresos de Florida": "Florida Department of Revenue",
  "Centro de ayuda de Airbnb": "Airbnb Help Center",
  "Ciudad de Miami Beach": "City of Miami Beach",
  "Condado de Miami-Dade": "Miami-Dade County",
  "Ciudad de Miami": "City of Miami",
  "Ciudad de Sunny Isles Beach": "City of Sunny Isles Beach",
  "Ciudad de Fort Lauderdale": "City of Fort Lauderdale",
  "Condado de Broward": "Broward County",
  "Condado de Palm Beach": "Palm Beach County",
  "Contralor de Texas (impuestos)": "Texas Comptroller (taxes)",
  "CDTFA (impuestos de California)": "CDTFA (California taxes)",
};

type TopicCopy = Pick<StrTopic, "title" | "summary" | "bullets">;
type JurisdictionCopy = {
  cityLabel?: string;
  county?: string;
  municipality?: string;
  matchReason: string;
  topics: Record<StrTopic["id"], TopicCopy>;
};

const commonPlatforms = (city: string, license: string): TopicCopy => ({
  title: "Compliance on Airbnb, Vrbo, and direct bookings",
  summary: `In ${city}, the listing must match the local registration, building rules, and what Isabela and NeighborShield tell guests.`,
  bullets: [
    license,
    "House rules must agree on quiet hours, occupancy, parking, and parties. The handbook and listing must state the same hours.",
    "Do not promise unlawful amenities or occupancy above the certificate or fire code.",
    "Direct bookings require the same taxes, registration, and cancellation policy. The channel does not eliminate occupancy taxes.",
  ],
});

const commonSafety = (city: string, extra: string): TopicCopy => ({
  title: "Safety, occupancy, and noise",
  summary: `Fire code and noise rules in ${city} apply to the owner, not only to the guest.`,
  bullets: [
    "Smoke and carbon-monoxide detectors, the fire extinguisher, and exit routes must match what the guest portal shows.",
    "Do not exceed the occupancy in the certificate or local code even if Airbnb permits a higher number.",
    extra,
    "After a hurricane or evacuation, follow county orders. Do not check guests in during a curfew or bridge closure.",
  ],
});

const copies: Record<string, (j: StrJurisdiction) => JurisdictionCopy> = {
  "miami-beach": () => ({
    municipality: "City of Miami Beach",
    matchReason: "The city and address match Miami Beach (for example, Collins Avenue or South Beach).",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Miami Beach requires vacation-rental registration, a visible license number in the listing, and often a 24/7 local contact. An HOA or condominium may prohibit stays shorter than 30 days even when the city permits them.", bullets: ["Confirm that the unit has a current vacation-rental certificate before opening the calendar.", "Publish the registration number on Airbnb/Vrbo and in Isabela’s handbook. A listing without a visible license may be fined or removed.", "Review maximum occupancy, any cap on nights, and whether the building requires board approval.", "Quiet hours, parties, and parking in coastal areas are often stricter than elsewhere in the county."] },
      taxes: { title: "Tourist and sales taxes", summary: "A Miami Beach rental shorter than six months usually combines state sales tax, the Miami-Dade surtax, county TDT, and the city lodging tax. Airbnb may collect only part; verify its coverage.", bullets: ["Register with the Florida Department of Revenue for direct bookings or when a channel does not remit the full combination.", "Miami Beach lodging tax is added to Miami-Dade TDT; do not use Brickell or Broward rates.", "If Airbnb says it collects occupancy tax, confirm whether the municipal portion is included. The host remains responsible for any gap.", "Keep records by property for nights, gross income, and collected tax. Financials can export data but does not file the return."] },
      platforms: commonPlatforms("Miami Beach", "Complete Airbnb’s municipal registration fields; leaving them blank may restrict the listing in this city."),
      safety: commonSafety("Miami Beach", "NeighborShield must state the same quiet hours as the listing—often 11:00 p.m. to 8:00 a.m. in the hotel district; confirm the current ordinance."),
    },
  }),
  "city-of-miami": () => ({
    cityLabel: "Miami (Brickell and other city neighborhoods)", municipality: "City of Miami",
    matchReason: "The location is in the City of Miami—Brickell, downtown, or another incorporated neighborhood—not Miami Beach.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "The City of Miami regulates short-term rentals separately from Miami Beach. In Brickell, condominium rules—board approval, minimum stays, and valet—are often the main constraint in addition to municipal registration.", bullets: ["Do not assume Miami Beach rules. Confirm City of Miami zoning and registration for this address.", "For towers, obtain written confirmation that stays shorter than 30 days are allowed and whether board approval is required.", "Single-family units or restricted residential zones may be prohibited even though the county collects TDT.", "Keep the registration number in the listing and handbook. The building desk does not replace a municipal license."] },
      taxes: { title: "Tourist and sales taxes", summary: "Brickell is in Miami-Dade: sales tax with county surtax plus TDT. Miami Beach’s 3% lodging tax does not apply.", bullets: ["Register with Florida Revenue for direct bookings or when Vrbo/Airbnb does not cover Miami-Dade TDT.", "The reference combination is state sales tax, Miami-Dade surtax, and county TDT. Verify current rates before quoting.", "Confirm in Airbnb which jurisdictions it collects for this property’s Brickell ZIP code.", "Export nights and income by property from Financials; TDT is filed by location, not as a mixed portfolio."] },
      platforms: commonPlatforms("the City of Miami", "Publish the City of Miami registration number when one exists; do not use a Miami Beach license format."),
      safety: commonSafety("Brickell / City of Miami", "Document tower parking, valet, and front-desk complaints and guest notices; municipal code may require evidence."),
    },
  }),
  "sunny-isles": () => ({
    municipality: "City of Sunny Isles Beach", matchReason: "The property is in Sunny Isles Beach, such as northern Collins Avenue or an oceanfront tower.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Sunny Isles towers commonly require a municipal certificate and condominium approval. Many buildings impose a 30-day minimum even when the city registers the unit.", bullets: ["Confirm the Sunny Isles Beach certificate of use or vacation-rental certificate for this unit.", "Review condominium documents for minimum stays, occupants, valet, and whether Airbnb is permitted.", "The registration number must agree across the listing, front desk, and Isabela handbook.", "Do not copy Miami Beach rules; occupancy, quiet hours, and valet requirements belong to the building and Sunny Isles."] },
      taxes: { title: "Tourist and sales taxes", summary: "Sunny Isles Beach is in Miami-Dade: sales tax, surtax, and county TDT. Do not use Miami Beach lodging tax.", bullets: ["Register with Florida Revenue when collecting outside a channel that remits Miami-Dade TDT.", "Airbnb may collect county TDT; verify the breakdown for the Sunny Isles ZIP code.", "Direct bookings and building valet or amenity deposits may receive different tax treatment; consult your accountant.", "Report this property separately; mixing it with Miami Beach distorts TDT and resort tax."] },
      platforms: commonPlatforms("Sunny Isles Beach", "If the building requires approval, do not publish the calendar until it is in writing. Airbnb does not override condominium rules."),
      safety: commonSafety("Sunny Isles Beach", "Valet, penthouse-elevator access, and tower quiet hours must match the listing. Complaints commonly go first to building management."),
    },
  }),
  "fort-lauderdale": () => ({
    municipality: "City of Fort Lauderdale", matchReason: "The property is in Fort Lauderdale / Broward County.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Fort Lauderdale requires a municipal license or business tax receipt as well as zoning compliance. Some residential neighborhoods, especially single-family areas, restrict or prohibit rentals shorter than 30 days.", bullets: ["Verify the parcel zoning; do not assume a villa near Las Olas is permitted.", "Obtain the Fort Lauderdale business tax receipt or vacation-rental registration when required for this address.", "HOA, channel, and alley parking rules are separate; a side gate does not remove tax-registration duties.", "Publish the license number where required. Broward does not use Miami Beach’s form."] },
      taxes: { title: "Tourist and sales taxes", summary: "Broward rentals shorter than six months pay sales tax with county surtax plus Broward TDT. Do not use Miami-Dade rates.", bullets: ["Register with the Florida Department of Revenue for remittances Airbnb or Vrbo does not cover.", "Broward TDT differs from Miami-Dade TDT; quote this county’s rate.", "Confirm which taxes the channel collects for the Fort Lauderdale ZIP code.", "Keep books by property. Financials can export nights; you or your accountant files the return."] },
      platforms: commonPlatforms("Fort Lauderdale", "Include the Broward / Fort Lauderdale registration number. A Miami-Dade field does not cover this villa."),
      safety: commonSafety("Fort Lauderdale", "For pools, alleys, and neighbor noise, NeighborShield should preserve date and time; municipal code may fine the owner."),
    },
  }),
  "miami-dade-other": (j) => ({
    matchReason: "The location is in Miami-Dade outside Miami Beach, Sunny Isles, and the Brickell / City of Miami profile already covered.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Each Miami-Dade municipality—including Coral Gables, Doral, Aventura, Homestead, and unincorporated areas—has its own ordinance. County TDT does not mean a vacation rental is permitted.", bullets: [`Confirm with ${j.cityLabel} whether this address permits rentals shorter than 30 days and which certificate is required.`, "Review HOA rules and, in an unincorporated area, county rules in addition to municipal rules.", "Do not copy the Miami Beach workflow; licenses, occupancy, and advertising vary by municipality.", "Keep the local registration number in the listing and Isabela’s handbook when one exists."] },
      taxes: { title: "Tourist and sales taxes", summary: "The Miami-Dade combination applies: sales tax, surtax, and TDT. Miami Beach add-on taxes apply only when the unit is actually there.", bullets: ["Use Florida Revenue for sales tax and Miami-Dade TDT for short stays unless the channel remits them.", "Some cities charge a business tax receipt separately from TDT; ask the municipal office.", "Verify Airbnb’s breakdown for this property’s ZIP code.", "Do not combine reports with Broward or Miami Beach units."] },
      platforms: commonPlatforms(j.cityLabel, "Use this municipality’s registration number, not one from another city in the portfolio."),
      safety: commonSafety(j.cityLabel, "Confirm local quiet hours and the correct 311 or police contact; do not reuse Miami Beach text."),
    },
  }),
  "broward-other": (j) => ({
    matchReason: "The location is in Broward County outside the specific Fort Lauderdale profile.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Hollywood, Pompano, Weston, Davie, and other Broward cities regulate short-term rentals independently. Single-family residential zoning is commonly the most restrictive.", bullets: [`Consult ${j.cityLabel}’s ordinance and the zoning map for this parcel.`, "A municipal license or business tax receipt may be required even though Fort Lauderdale uses a different form.", "HOAs and gated communities in western Broward often prohibit stays shorter than 30 days.", "Publish the local registration number when the city requires it."] },
      taxes: { title: "Tourist and sales taxes", summary: "Broward TDT applies with sales tax and county surtax. Do not use Miami-Dade rates.", bullets: ["Confirm whether Airbnb remits Broward TDT for this ZIP code.", "For direct bookings, register with Florida Revenue and remit Broward TDT.", "A city business tax is separate from the county tourist tax.", "Keep this unit separate in Financials from Miami-Dade properties."] },
      platforms: commonPlatforms(j.cityLabel, "The license field must contain the registration for this Broward city."),
      safety: commonSafety(j.cityLabel, "Document guest notices for noise, street parking, and HOA complaints."),
    },
  }),
  "palm-beach": (j) => ({
    matchReason: "The address or city maps to Palm Beach County.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Palm Beach County and its cities—including West Palm Beach, Boca Raton, and Delray—have their own rules. Many residential areas restrict vacation rentals.", bullets: [`Verify zoning and registration with ${j.cityLabel} / Palm Beach County for this address.`, "Do not apply the Miami Beach or Broward package.", "Oceanfront condominiums commonly require a minimum stay or prohibit short-term rentals.", "Show the license in the listing when the municipality requires it."] },
      taxes: { title: "Tourist and sales taxes", summary: "Palm Beach sales tax and surtax apply with county TDT. These rates differ from Miami-Dade and Broward.", bullets: ["Confirm Palm Beach TDT remittance on Airbnb/Vrbo.", "For direct bookings, use Florida Revenue plus county TDT registration.", "Some cities charge additional local fees; ask the municipal office.", "Keep reports by property and do not combine them with South Florida jurisdictions."] },
      platforms: commonPlatforms(j.cityLabel, "Use the Palm Beach / local city registration, not a Miami-Dade number."),
      safety: commonSafety(j.cityLabel, "For hurricanes and coastal evacuation, follow Palm Beach County orders."),
    },
  }),
  "florida-fallback": (j) => ({
    municipality: j.cityLabel || "Municipality to be confirmed",
    matchReason: "There is no strong city or county match. State guidance is shown until the address is confirmed.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Florida has no single statewide vacation-rental license. Each city or county determines whether short-term rentals are permitted.", bullets: ["Confirm zoning, certificates, and HOA rules for the property’s exact address.", "Review night limits, occupancy, and whether the building prohibits stays shorter than 30 days.", "Publish the local registration number when one exists.", "Update the city and address in Properties so Zencierge can refine this guidance."] },
      taxes: { title: "Tourist and sales taxes", summary: "Stays shorter than six months commonly owe Florida sales tax plus county TDT. Rates differ across the state.", bullets: ["Identify the county—Miami-Dade, Broward, Palm Beach, or another—from the ZIP code.", "Register with Florida Revenue for direct collections or when a channel does not remit the full tax.", "Airbnb may collect only part of the required jurisdictions.", "Financials exports activity; it does not file the return."] },
      platforms: commonPlatforms(j.cityLabel || "this property", "Complete Airbnb registration fields with the correct local number."),
      safety: commonSafety(j.cityLabel || "Florida", "Use the actual municipality’s fire, occupancy, and quiet-hours rules, not generic text."),
    },
  }),
  texas: (j) => ({
    county: "Texas county for this address",
    matchReason: "The city or time zone maps to Texas. Hotel occupancy tax combines state and municipal/county components.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Texas does not use one statewide short-term-rental system. Austin, Dallas, Houston, and smaller cities may require registration, a local contact, and occupancy limits. HOAs may prohibit short stays.", bullets: [`Confirm short-term-rental registration in ${j.cityLabel} and the parcel zoning map.`, "Austin’s framework has changed repeatedly; do not copy a Florida license number.", "Publish the permit number on Airbnb when the city requires it.", "Review HOA rules and condominium minimum stays."] },
      taxes: { title: "Tourist and sales taxes", summary: "Texas charges a 6% state hotel occupancy tax plus city and sometimes county or district taxes. Airbnb may collect only part.", bullets: ["Register with the Texas Comptroller for direct bookings or when the channel does not remit the full hotel occupancy tax.", "Austin, Dallas, and Houston have different local rates; verify this address.", "Do not use Florida TDT as the reference for this unit.", "Financials exports nights; it does not file the return."] },
      platforms: commonPlatforms(j.cityLabel, "Use this Texas city’s registration number, not a Miami-Dade certificate."),
      safety: commonSafety(j.cityLabel, "For tornadoes and extreme heat, follow local alerts and do not invent shelter codes."),
    },
  }),
  california: (j) => ({
    county: "California county for this address",
    matchReason: "The location or time zone maps to California. Each city, and often the county, regulates short-term rentals.",
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: "Los Angeles, San Diego, and San Francisco use registrations, night caps, and host-presence rules. A county process does not replace a city permit.", bullets: [`Consult ${j.cityLabel}’s vacation-rental program for this address.`, "Many cities require a visible registration number in the listing.", "HOA restrictions and rent control are separate; review both.", "Do not copy the Florida TDT / Miami Beach workflow."] },
      taxes: { title: "Tourist and sales taxes", summary: "The city sets transient occupancy tax. Airbnb commonly collects TOT across much of California; confirm the breakdown.", bullets: ["Register with the municipal occupancy-tax office for direct bookings.", "Rates vary by city; verify the current one.", "Some counties impose additional measures.", "Keep this property separate from Florida units in Financials."] },
      platforms: commonPlatforms(j.cityLabel, "Publish the California / local city registration number."),
      safety: commonSafety(j.cityLabel, "For fires and evacuations, follow county orders; for earthquakes, keep exit routes clear."),
    },
  }),
};

function genericEnglish(j: StrJurisdiction): JurisdictionCopy {
  const city = j.cityLabel;
  return {
    county: j.county.startsWith("Según") ? `County for ${j.stateLabel} address` : j.county,
    municipality: j.municipality === "Municipio por confirmar" ? "Municipality to be confirmed" : j.municipality,
    matchReason: `The location maps to ${j.stateLabel}. Confirm the city and county in Properties to refine ordinances and taxes.`,
    topics: {
      zoning: { title: "Short-term rental zoning and permits", summary: `There is no single federal short-term-rental license for ${j.stateLabel}. The city and county determine whether vacation rentals are permitted.`, bullets: ["Confirm zoning, registration, and HOA rules for the exact address.", "Publish the local registration number when one exists.", "Review maximum occupancy and the building’s minimum stay.", "Keep the city, address, and time zone current in Properties."] },
      taxes: { title: "Tourist and sales taxes", summary: "Short stays commonly owe local occupancy tax and sometimes sales tax. Airbnb does not always collect every component.", bullets: ["Identify the city and county tax authority.", "Register with the state revenue department for direct bookings when required.", "Verify what Airbnb collects for this ZIP code.", "Financials exports activity; it does not file the return."] },
      platforms: commonPlatforms(city, "Use this jurisdiction’s registration number, not one from another property in the portfolio."),
      safety: commonSafety(city, "Use the actual municipality’s fire, noise, and emergency rules."),
    },
  };
}

export function localizeJurisdiction(jurisdiction: StrJurisdiction, lang: GuideLang): StrJurisdiction {
  if (lang === "es") return jurisdiction;
  const copy = copies[jurisdiction.id]?.(jurisdiction) ?? genericEnglish(jurisdiction);
  return {
    ...jurisdiction,
    stateLabel: jurisdiction.stateLabel === "Nueva York" ? "New York" : jurisdiction.stateLabel,
    cityLabel: copy.cityLabel ?? jurisdiction.cityLabel,
    county: copy.county ?? jurisdiction.county,
    municipality: copy.municipality ?? jurisdiction.municipality,
    matchReason: copy.matchReason,
    taxRates: jurisdiction.taxRates.map((rate) => ({
      label: TAX_LABELS[rate.label] ?? rate.label,
      value: VALUE_LABELS[rate.value] ?? rate.value,
    })),
    topics: jurisdiction.topics.map((topic) => ({ id: topic.id, ...copy.topics[topic.id] })),
    links: jurisdiction.links.map((link) => ({ ...link, label: LINK_LABELS[link.label] ?? link.label })),
  };
}
