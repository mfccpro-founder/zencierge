import {
  resolveFloridaStrJurisdiction,
  type StrJurisdiction,
  type StrTopic,
} from "@/lib/florida-str-jurisdiction";

export type { StrJurisdiction, StrTopic };

function haystack(parts: string[]) {
  return parts
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function platforms(city: string, licenseNote: string): StrTopic {
  return {
    id: "platforms",
    title: "Cumplimiento en Airbnb, Vrbo y reservas directas",
    summary: `En ${city}, el anuncio debe coincidir con el registro local, las reglas del edificio y lo que Elena dice a los huéspedes.`,
    bullets: [
      licenseNote,
      "Reglas de la casa: silencio, ocupación, estacionamiento y fiestas. El manual y el anuncio deben citar las mismas horas.",
      "No prometas amenidades ilegales ni una ocupación mayor que el certificado o el código de incendios.",
      "Reservas directas: mismo impuesto y mismo registro. El canal no exime del occupancy tax local.",
    ],
  };
}

function safety(city: string, extra: string): StrTopic {
  return {
    id: "safety",
    title: "Seguridad, ocupación y ruido",
    summary: `El código de incendios y las reglas de ruido en ${city} se aplican al dueño.`,
    bullets: [
      "Detectores de humo y de monóxido, extintor y vías de salida deben coincidir con el portal del huésped.",
      "No excedas la ocupación del certificado local, aunque Airbnb permita un número mayor.",
      extra,
      "Sigue órdenes de evacuación del condado o del estado. No hagas el check-in si hay toque de queda.",
    ],
  };
}

function inferState(input: { city: string; address: string; timezone?: string }): string {
  const text = haystack([input.city, input.address, input.timezone ?? ""]);
  if (includesAny(text, ["austin", "dallas", "houston", "san antonio", "texas", "america/chicago"])) {
    if (includesAny(text, ["miami", "broward", "orlando", "tampa", "florida", "america/new_york"])) {
      /* Chicago can be Florida panhandle; prefer FL city hits */
      if (includesAny(text, ["miami", "broward", "orlando", "tampa", "florida"])) return "FL";
    }
    if (includesAny(text, ["austin", "dallas", "houston", "san antonio", "texas"])) return "TX";
  }
  if (includesAny(text, ["los angeles", "san diego", "san francisco", "california", "america/los_angeles"])) return "CA";
  if (includesAny(text, ["denver", "colorado", "america/denver"])) return "CO";
  if (includesAny(text, ["new york", "brooklyn", "manhattan", "america/new_york"]) && includesAny(text, ["nyc", "brooklyn", "manhattan", "queens"])) {
    return "NY";
  }
  if (includesAny(text, ["florida", "miami", "orlando", "tampa", "jacksonville", "fort lauderdale", "sunny isles", "brickell"])) {
    return "FL";
  }
  if (input.timezone === "America/Chicago" && includesAny(text, ["austin", "dallas", "houston"])) return "TX";
  if (input.timezone === "America/Los_Angeles") return "CA";
  if (input.timezone === "America/Denver") return "CO";
  return "FL";
}

function texas(city: string): StrJurisdiction {
  const label = city || "Texas";
  return {
    id: "texas",
    stateCode: "TX",
    stateLabel: "Texas",
    cityLabel: label,
    county: "Según condado de Texas",
    municipality: label,
    matchReason: "La ciudad o la zona horaria apuntan a Texas. El occupancy tax es estatal más municipal/condado.",
    taxRates: [
      { label: "Impuesto estatal de hospedaje (Texas)", value: "6%" },
      { label: "Impuesto municipal / de condado", value: "Hasta ~7% local" },
      { label: "Ventas (si aplica a extras)", value: "Según ciudad" },
    ],
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Texas no unifica el STR. Austin, Dallas, Houston y las ciudades menores exigen registro, a veces un contacto local y límites de ocupación. Las HOA pueden prohibir estancias cortas.",
        bullets: [
          `Confirma el registro de alquiler a corto plazo en ${label} y el mapa de zonificación de esta parcela.`,
          "En Austin el marco ha cambiado varias veces: no copies un número de licencia de Florida.",
          "Publica el número de permiso en Airbnb cuando la ciudad lo exija.",
          "Revisa HOA y, en condominios, el mínimo de noches.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary:
          "Texas cobra hotel occupancy tax estatal (6%) más tasas de ciudad y, a veces, de condado o distrito. Airbnb puede recaudar una parte.",
        bullets: [
          "Regístrate ante el Contralor de Texas si hay reservas directas o si el canal no remite el HOT completo.",
          "Austin, Dallas y Houston tienen tasas locales distintas. Verifica la de esta dirección.",
          "No uses TDT de Florida como referencia para esta unidad.",
          "Financials exporta noches; no presenta la declaración.",
        ],
      },
      platforms(label, "Usa el número de registro de esta ciudad de Texas, no un certificado de Miami-Dade."),
      safety(label, "Tornados y calor extremo: sigue avisos locales; no inventes códigos de refugio."),
    ],
    links: [
      { href: "https://comptroller.texas.gov/", label: "Contralor de Texas (impuestos)" },
      { href: "https://www.airbnb.com/help", label: "Centro de ayuda de Airbnb" },
    ],
  };
}

function california(city: string): StrJurisdiction {
  const label = city || "California";
  return {
    id: "california",
    stateCode: "CA",
    stateLabel: "California",
    cityLabel: label,
    county: "Según condado de California",
    municipality: label,
    matchReason: "La ubicación o la zona horaria apuntan a California. Cada ciudad (y a menudo el condado) regula el STR.",
    taxRates: [
      { label: "Transient occupancy tax (TOT) municipal", value: "Según ciudad" },
      { label: "Impuesto de ventas de California", value: "Según distrito" },
    ],
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Los Ángeles, San Diego y San Francisco tienen registros, topes de noches y reglas de anfitrión presente. El condado no sustituye el permiso de la ciudad.",
        bullets: [
          `Consulta el programa de alquiler vacacional de ${label} para esta dirección.`,
          "Muchas ciudades exigen número de registro visible en el anuncio.",
          "HOA y rent-control no son lo mismo: revisa ambos.",
          "No copies el flujo de Florida (TDT / Miami Beach).",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary: "El TOT lo fija la ciudad. Airbnb suele recaudar TOT en gran parte de California; confirma el desglose.",
        bullets: [
          "Regístrate en la ventanilla municipal de occupancy tax si cobras directo.",
          "Las tasas cambian por ciudad; verifica la vigente.",
          "Algunos condados añaden medidas propias.",
          "Separa esta propiedad de unidades de Florida en Financials.",
        ],
      },
      platforms(label, "Publica el número de registro de California / esta ciudad."),
      safety(label, "Incendios y evacuaciones: sigue órdenes del condado. Terremotos: vías de salida claras."),
    ],
    links: [
      { href: "https://www.cdtfa.ca.gov/", label: "CDTFA (impuestos de California)" },
      { href: "https://www.airbnb.com/help", label: "Centro de ayuda de Airbnb" },
    ],
  };
}

function genericUs(city: string, stateCode: string, stateLabel: string): StrJurisdiction {
  const label = city || stateLabel;
  return {
    id: `us-${stateCode.toLowerCase()}`,
    stateCode,
    stateLabel,
    cityLabel: label,
    county: "Según condado",
    municipality: label,
    matchReason: `Se detectó el estado ${stateLabel}. Confirma ciudad y condado en Properties para afinar ordenanzas e impuestos.`,
    taxRates: [
      { label: "Impuesto estatal / occupancy", value: "Según estado" },
      { label: "Impuesto de ciudad o condado", value: "Según jurisdicción" },
    ],
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary: `En ${stateLabel} no hay una licencia federal. La ciudad y el condado definen si se permite el alquiler vacacional.`,
        bullets: [
          "Confirma zonificación, certificado y HOA para la dirección exacta.",
          "Publica el número de registro local cuando exista.",
          "Revisa ocupación máxima y mínimo de noches del edificio.",
          "Actualiza ciudad, dirección y zona horaria en Properties.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary: "Los alquileres cortos suelen pagar occupancy tax local más, a veces, impuesto de ventas. Airbnb no siempre cubre todo.",
        bullets: [
          "Identifica la autoridad fiscal de la ciudad y del condado.",
          "Regístrate en el departamento de ingresos del estado si cobras directo.",
          "Verifica qué recauda Airbnb para este código postal.",
          "Financials exporta actividad; no presenta la declaración.",
        ],
      },
      platforms(label, "Usa el número de registro de esta jurisdicción, no el de otra propiedad del portafolio."),
      safety(label, "Código de incendios y silencio: usa las reglas del municipio real."),
    ],
    links: [{ href: "https://www.airbnb.com/help", label: "Centro de ayuda de Airbnb" }],
  };
}

export function resolveUsStrJurisdiction(input: {
  city: string;
  address: string;
  timezone?: string;
}): StrJurisdiction {
  const state = inferState(input);
  if (state === "FL") return resolveFloridaStrJurisdiction({ city: input.city, address: input.address });
  if (state === "TX") return texas(input.city.trim() || "Texas");
  if (state === "CA") return california(input.city.trim() || "California");
  const labels: Record<string, string> = { CO: "Colorado", NY: "Nueva York" };
  return genericUs(input.city.trim(), state, labels[state] ?? state);
}
