export type FloridaCounty = "Miami-Dade" | "Broward" | "Palm Beach" | "Florida";

export type StrTopic = {
  id: "zoning" | "taxes" | "platforms" | "safety";
  title: string;
  summary: string;
  bullets: string[];
};

export type StrJurisdiction = {
  id: string;
  stateCode: string;
  stateLabel: string;
  cityLabel: string;
  county: string;
  municipality: string;
  matchReason: string;
  taxRates: { label: string; value: string }[];
  topics: StrTopic[];
  links: { href: string; label: string }[];
};

const STATE_LINKS = [
  { href: "https://floridarevenue.com/", label: "Departamento de Ingresos de Florida" },
  { href: "https://www.airbnb.com/help", label: "Centro de ayuda de Airbnb" },
];

function haystack(city: string, address: string) {
  return `${city} ${address}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function miamiDadeTaxes(extra: { label: string; value: string }[]): StrJurisdiction["taxRates"] {
  return [
    { label: "Impuesto de ventas de Florida", value: "6%" },
    { label: "Recargo discrecional (Miami-Dade)", value: "1%" },
    { label: "TDT del condado Miami-Dade", value: "6%" },
    ...extra,
  ];
}

function browardTaxes(): StrJurisdiction["taxRates"] {
  return [
    { label: "Impuesto de ventas de Florida", value: "6%" },
    { label: "Recargo discrecional (Broward)", value: "1%" },
    { label: "TDT del condado Broward", value: "6%" },
  ];
}

function platformsTopic(city: string, licenseNote: string): StrTopic {
  return {
    id: "platforms",
    title: "Cumplimiento en Airbnb, Vrbo y reservas directas",
    summary: `En ${city}, el anuncio debe coincidir con el registro local, las reglas del edificio y lo que Elena y NeighborShield dicen a los huéspedes.`,
    bullets: [
      licenseNote,
      "Reglas de la casa: horarios de silencio, ocupación, estacionamiento y fiestas. El manual y el anuncio deben citar las mismas horas.",
      "No prometas amenidades ilegales ni una ocupación mayor que el certificado o el código de incendios.",
      "Reservas directas: mismo impuesto, mismo registro y misma política de cancelación. El canal no exime del TDT.",
    ],
  };
}

function safetyTopic(city: string, extra: string): StrTopic {
  return {
    id: "safety",
    title: "Seguridad, ocupación y ruido",
    summary: `El código de incendios y las reglas de ruido en ${city} se aplican al dueño, no solo al huésped.`,
    bullets: [
      "Detectores de humo y de monóxido, extintor y vías de salida deben coincidir con lo que muestras en el portal del huésped.",
      "No excedas la ocupación del certificado o del código local, aunque el calendario de Airbnb permita un número mayor.",
      extra,
      "Tras un huracán o una evacuación, sigue las órdenes del condado. No hagas el check-in si hay toque de queda o cierre de puentes.",
    ],
  };
}

function miamiBeach(): StrJurisdiction {
  return {
    id: "miami-beach",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel: "Miami Beach",
    county: "Miami-Dade",
    municipality: "Ciudad de Miami Beach",
    matchReason: "Ciudad y dirección coinciden con Miami Beach (p. ej. Collins Ave, South Beach).",
    taxRates: miamiDadeTaxes([{ label: "Impuesto de hospedaje / resort de Miami Beach", value: "3%" }]),
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Miami Beach exige registro de alquiler vacacional, número de licencia visible en el anuncio y, en muchos casos, un contacto local 24/7. La HOA o el condominio puede prohibir estancias de menos de 30 días aunque la ciudad lo permita.",
        bullets: [
          "Confirma que la unidad tiene certificado de alquiler vacacional vigente antes de abrir el calendario.",
          "Publica el número de registro en Airbnb/Vrbo y en el manual de Elena. Un anuncio sin licencia visible puede terminar en multa o baja.",
          "Revisa ocupación máxima (huéspedes por recámara), tope de noches si aplica, y si el edificio exige aprobación de la junta.",
          "Horarios de silencio, fiestas y estacionamiento en la zona costera suelen ser más estrictos que en el resto del condado.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary:
          "En Miami Beach, un alquiler de menos de seis meses suele combinar impuesto de ventas estatal, recargo de Miami-Dade, TDT del condado e impuesto de hospedaje de la ciudad. Airbnb puede recaudar una parte; verifica qué cubre.",
        bullets: [
          "Regístrate en el Departamento de Ingresos de Florida si cobras reservas directas o si el canal no remite el esquema completo.",
          "El impuesto de hospedaje de Miami Beach se suma al TDT de Miami-Dade; no uses la tasa de Brickell o de Broward como referencia.",
          "Si Airbnb indica que recauda el impuesto de ocupación, confirma si incluye la porción municipal. Lo que falte sigue siendo del anfitrión.",
          "Lleva un registro por propiedad (noches, ingresos brutos, impuesto cobrado). Financials ayuda a exportar; no sustituye la declaración.",
        ],
      },
      platformsTopic(
        "Miami Beach",
        "Airbnb tiene campos de registro municipal: déjalos vacíos y el anuncio puede quedar limitado en esta ciudad.",
      ),
      safetyTopic(
        "Miami Beach",
        "NeighborShield debe citar las mismas horas de silencio que el anuncio (con frecuencia 11:00 p. m. a 8:00 a. m. en zona hotelera; confirma la ordenanza vigente).",
      ),
    ],
    links: [
      { href: "https://www.miamibeachfl.gov/", label: "Ciudad de Miami Beach" },
      { href: "https://www.miamidade.gov/", label: "Condado de Miami-Dade" },
      ...STATE_LINKS,
    ],
  };
}

function cityOfMiami(): StrJurisdiction {
  return {
    id: "city-of-miami",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel: "Miami (Brickell y otras zonas de la ciudad)",
    county: "Miami-Dade",
    municipality: "Ciudad de Miami",
    matchReason: "La ubicación corresponde a la Ciudad de Miami (Brickell, centro u otra zona incorporada), no a Miami Beach.",
    taxRates: miamiDadeTaxes([]),
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "La Ciudad de Miami regula el alquiler a corto plazo aparte de Miami Beach. En Brickell el cuello de botella suele ser el condominio (junta, mínimo de noches, valet), además del registro municipal.",
        bullets: [
          "No asumas las reglas de Miami Beach. Confirma zonificación y registro ante la Ciudad de Miami para esta dirección.",
          "En torres, pide por escrito si el reglamento permite estancias de menos de 30 días y si hace falta aprobación de la junta.",
          "Unidades unifamiliares o en zonas residenciales restringidas pueden estar prohibidas aunque el condado recaude TDT.",
          "Guarda el número de registro en el anuncio y en el manual. El escritorio del edificio no sustituye la licencia municipal.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary:
          "Brickell está en Miami-Dade: impuesto de ventas (con recargo del condado) más TDT. No aplica el impuesto de hospedaje del 3% de Miami Beach.",
        bullets: [
          "Regístrate en ingresos de Florida si hay reservas directas o si Vrbo/Airbnb no cubren el TDT de Miami-Dade.",
          "La tasa combinada de referencia es estatal + recargo de Miami-Dade + TDT del condado. Verifica la vigencia antes de cotizar.",
          "Confirma en el panel de Airbnb qué jurisdicciones recauda el canal para esta dirección (código postal de Brickell).",
          "Exporta noches e ingresos desde Financials por propiedad; el TDT se declara por ubicación, no por portafolio mezclado.",
        ],
      },
      platformsTopic(
        "la Ciudad de Miami",
        "Publica el número de registro de la Ciudad de Miami cuando exista. No uses el formato de licencia de Miami Beach.",
      ),
      safetyTopic(
        "Brickell / Ciudad de Miami",
        "Estacionamiento de torre, valet y quejas al escritorio: documenta avisos al huésped; el código municipal puede pedir prueba.",
      ),
    ],
    links: [
      { href: "https://www.miami.gov/", label: "Ciudad de Miami" },
      { href: "https://www.miamidade.gov/", label: "Condado de Miami-Dade" },
      ...STATE_LINKS,
    ],
  };
}

function sunnyIsles(): StrJurisdiction {
  return {
    id: "sunny-isles",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel: "Sunny Isles Beach",
    county: "Miami-Dade",
    municipality: "Ciudad de Sunny Isles Beach",
    matchReason: "La propiedad está en Sunny Isles Beach (p. ej. Collins Ave norte, torres frente al mar).",
    taxRates: miamiDadeTaxes([]),
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "En torres de Sunny Isles, el alquiler a corto plazo suele exigir certificado municipal y aprobación del condominio. Muchos edificios imponen un mínimo de 30 días aunque la ciudad registre la unidad.",
        bullets: [
          "Confirma el certificado de uso / alquiler vacacional de Sunny Isles Beach para esta unidad.",
          "Revisa documentos del condominio: mínimo de noches, ocupantes, valet y si se permite Airbnb.",
          "El número de registro debe coincidir en el anuncio, la recepción y el manual de Elena.",
          "No copies las reglas de Miami Beach: ocupación, silencios y valet son los del edificio y de Sunny Isles.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary:
          "Sunny Isles Beach está en Miami-Dade: ventas + recargo + TDT del condado. No uses el impuesto de hospedaje de Miami Beach.",
        bullets: [
          "Regístrate en Florida Revenue si cobras fuera de un canal que remita el TDT de Miami-Dade.",
          "Airbnb puede recaudar TDT del condado; verifica el desglose para el código postal de Sunny Isles.",
          "Reservas directas y depósitos de valet o amenidades del edificio pueden tener tratamiento fiscal distinto: consulta a tu contador.",
          "Separa esta propiedad en reportes; mezclarla con Miami Beach distorsiona el TDT y el resort tax.",
        ],
      },
      platformsTopic(
        "Sunny Isles Beach",
        "Si el edificio exige aprobación, no publiques el calendario hasta tenerla por escrito. Airbnb no anula el reglamento del condominio.",
      ),
      safetyTopic(
        "Sunny Isles Beach",
        "Valet, elevador de penthouse y horario de silencio de la torre deben coincidir con el anuncio. Las quejas suelen ir primero a la administración del edificio.",
      ),
    ],
    links: [
      { href: "https://www.sibfl.net/", label: "Ciudad de Sunny Isles Beach" },
      { href: "https://www.miamidade.gov/", label: "Condado de Miami-Dade" },
      ...STATE_LINKS,
    ],
  };
}

function fortLauderdale(): StrJurisdiction {
  return {
    id: "fort-lauderdale",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel: "Fort Lauderdale",
    county: "Broward",
    municipality: "Ciudad de Fort Lauderdale",
    matchReason: "La propiedad está en Fort Lauderdale / condado Broward.",
    taxRates: browardTaxes(),
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Fort Lauderdale exige licencia o recibo de impuesto de negocio municipal además de cumplir zonificación. Algunos vecindarios residenciales (sobre todo unifamiliares) restringen o prohíben el alquiler de menos de 30 días.",
        bullets: [
          "Verifica zonificación de esta parcela (no asumas que una villa cerca de Las Olas está permitida).",
          "Obtén el business tax receipt / registro de alquiler vacacional de Fort Lauderdale si aplica a esta dirección.",
          "HOA, canal y estacionamiento en callejón tienen reglas propias; el portón lateral no exime del registro fiscal.",
          "Publica el número de licencia donde la ciudad lo exija. Broward no usa el mismo formulario que Miami Beach.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary:
          "Los alquileres de menos de seis meses en Broward pagan impuesto de ventas (con recargo del condado) más el TDT de Broward. No uses las tasas de Miami-Dade.",
        bullets: [
          "Regístrate en el Departamento de Ingresos de Florida para remesas que Airbnb o Vrbo no cubran.",
          "El TDT de Broward es distinto del de Miami-Dade. Cotiza con la tasa de este condado.",
          "Confirma en el canal qué impuestos recauda para el código postal de Fort Lauderdale.",
          "Lleva libros por propiedad. Financials puede exportar noches; la declaración la haces tú o tu contador.",
        ],
      },
      platformsTopic(
        "Fort Lauderdale",
        "Incluye el número de registro de Broward / Fort Lauderdale en el anuncio. Un campo de Miami-Dade no sirve para esta villa.",
      ),
      safetyTopic(
        "Fort Lauderdale",
        "Piscina, callejón y ruido hacia vecinos: NeighborShield debe guardar fecha y hora. El código municipal puede multar al dueño.",
      ),
    ],
    links: [
      { href: "https://www.fortlauderdale.gov/", label: "Ciudad de Fort Lauderdale" },
      { href: "https://www.broward.org/", label: "Condado de Broward" },
      ...STATE_LINKS,
    ],
  };
}

function miamiDadeOther(cityLabel: string): StrJurisdiction {
  return {
    id: "miami-dade-other",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel,
    county: "Miami-Dade",
    municipality: cityLabel,
    matchReason: "La ubicación está en Miami-Dade, fuera de Miami Beach, Sunny Isles y el perfil de Brickell/Ciudad de Miami ya cubierto.",
    taxRates: miamiDadeTaxes([]),
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Cada ciudad de Miami-Dade (Coral Gables, Doral, Aventura, Homestead, zona no incorporada) tiene su propia ordenanza. El TDT del condado no implica que el alquiler vacacional esté permitido.",
        bullets: [
          `Confirma con ${cityLabel} si esta dirección permite alquiler de menos de 30 días y qué certificado hace falta.`,
          "Revisa HOA y, si es zona no incorporada, las reglas del condado además de las municipales.",
          "No copies el flujo de Miami Beach: licencias, ocupación y publicidad cambian de un municipio a otro.",
          "Guarda el número de registro local en el anuncio y en Elena cuando exista.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary:
          "Aplica el esquema de Miami-Dade (ventas + recargo + TDT). Impuestos extra de Miami Beach no aplican salvo que la unidad esté realmente allí.",
        bullets: [
          "Florida Revenue para ventas; TDT de Miami-Dade para estancias cortas, salvo que el canal las remita.",
          "Algunas ciudades cobran business tax receipt aparte del TDT. Pregunta en ventanilla municipal.",
          "Verifica el desglose de Airbnb para el código postal de esta propiedad.",
          "No mezcles reportes con unidades de Broward o de Miami Beach.",
        ],
      },
      platformsTopic(cityLabel, "Usa el número de registro de este municipio, no el de otra ciudad del portafolio."),
      safetyTopic(cityLabel, "Confirma horas de silencio y 311 o policía local; no reutilices el texto de Miami Beach."),
    ],
    links: [
      { href: "https://www.miamidade.gov/", label: "Condado de Miami-Dade" },
      ...STATE_LINKS,
    ],
  };
}

function browardOther(cityLabel: string): StrJurisdiction {
  return {
    id: "broward-other",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel,
    county: "Broward",
    municipality: cityLabel,
    matchReason: "La ubicación está en el condado Broward, fuera del perfil específico de Fort Lauderdale.",
    taxRates: browardTaxes(),
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Hollywood, Pompano, Weston, Davie y otras ciudades de Broward regulan el STR por su cuenta. Zonificación residencial unifamiliar suele ser la más restrictiva.",
        bullets: [
          `Consulta la ordenanza de ${cityLabel} y el mapa de zonificación de esta parcela.`,
          "Licencia municipal o BTR puede ser obligatoria aunque Fort Lauderdale tenga otro formulario.",
          "HOA y gated communities en el oeste de Broward a menudo prohíben menos de 30 días.",
          "Publica el registro local en el anuncio cuando la ciudad lo exija.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary: "TDT de Broward más impuesto de ventas con recargo del condado. No uses tasas de Miami-Dade.",
        bullets: [
          "Confirma si Airbnb remite el TDT de Broward para este código postal.",
          "Reservas directas: alta en Florida Revenue y remesa de TDT de Broward.",
          "Business tax de la ciudad es aparte del impuesto turístico del condado.",
          "Separa esta unidad en Financials respecto a propiedades de Miami-Dade.",
        ],
      },
      platformsTopic(cityLabel, "El campo de licencia debe ser el de esta ciudad de Broward."),
      safetyTopic(cityLabel, "Ruido, estacionamiento en calle y quejas de HOA: documenta avisos al huésped."),
    ],
    links: [
      { href: "https://www.broward.org/", label: "Condado de Broward" },
      ...STATE_LINKS,
    ],
  };
}

function palmBeach(cityLabel: string): StrJurisdiction {
  return {
    id: "palm-beach",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel,
    county: "Palm Beach",
    municipality: cityLabel,
    matchReason: "La dirección o ciudad apunta al condado Palm Beach.",
    taxRates: [
      { label: "Impuesto de ventas de Florida", value: "6%" },
      { label: "Recargo discrecional (Palm Beach)", value: "1%" },
      { label: "TDT del condado Palm Beach", value: "6%" },
    ],
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Palm Beach County y sus ciudades (West Palm Beach, Boca Raton, Delray, etc.) tienen reglas propias. Muchas zonas residenciales limitan el alquiler vacacional.",
        bullets: [
          `Verifica zonificación y registro en ${cityLabel} / Palm Beach County para esta dirección.`,
          "No apliques el paquete de Miami Beach ni el de Broward.",
          "Condominios frente al mar suelen exigir mínimo de noches o prohibir STR.",
          "Licencia visible en el anuncio si el municipio lo exige.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary: "Ventas con recargo de Palm Beach más TDT del condado. Tasas distintas a Miami-Dade y Broward.",
        bullets: [
          "Confirma remisión de TDT de Palm Beach en Airbnb/Vrbo.",
          "Reservas directas: Florida Revenue + TDT del condado.",
          "Algunas ciudades cobran tasas locales extra: pregunta en ventanilla.",
          "Reportes por propiedad; no mezclar con el sur de Florida.",
        ],
      },
      platformsTopic(cityLabel, "Usa el registro de Palm Beach / esta ciudad, no un número de Miami-Dade."),
      safetyTopic(cityLabel, "Huracanes y evacuaciones de costa: sigue órdenes del condado Palm Beach."),
    ],
    links: [
      { href: "https://discover.pbcgov.org/", label: "Condado de Palm Beach" },
      ...STATE_LINKS,
    ],
  };
}

function floridaFallback(cityLabel: string): StrJurisdiction {
  return {
    id: "florida-fallback",
    stateCode: "FL",
    stateLabel: "Florida",
    cityLabel: cityLabel || "Florida",
    county: "Florida",
    municipality: cityLabel || "Municipio por confirmar",
    matchReason:
      "No hay una coincidencia fuerte de ciudad o condado. Se muestra la guía estatal hasta que confirmes la dirección.",
    taxRates: [
      { label: "Impuesto de ventas de Florida (base)", value: "6%" },
      { label: "TDT / recargo local", value: "Según condado" },
    ],
    topics: [
      {
        id: "zoning",
        title: "Zonificación y permisos de alquiler a corto plazo",
        summary:
          "Florida no tiene una licencia única estatal. Cada ciudad o condado define si se permite el alquiler vacacional.",
        bullets: [
          "Confirma zonificación, certificado y HOA para la dirección exacta de esta propiedad.",
          "Revisa tope de noches, ocupación y si el edificio prohíbe menos de 30 días.",
          "Publica el número de registro local cuando exista.",
          "Actualiza ciudad y dirección en Properties para que Zencierge afine esta guía.",
        ],
      },
      {
        id: "taxes",
        title: "Impuestos turísticos y de ventas",
        summary:
          "Estancias de menos de seis meses suelen pagar impuesto de ventas de Florida más TDT del condado. Las tasas no son las mismas en todo el estado.",
        bullets: [
          "Identifica el condado (Miami-Dade, Broward, Palm Beach, etc.) a partir del código postal.",
          "Regístrate en Florida Revenue si cobras directo o si el canal no remite el impuesto completo.",
          "Airbnb puede recaudar solo una parte de las jurisdicciones.",
          "Financials exporta actividad; no presenta la declaración.",
        ],
      },
      platformsTopic(cityLabel || "esta propiedad", "Completa los campos de registro de Airbnb con el número local correcto."),
      safetyTopic(cityLabel || "Florida", "Código de incendios, ocupación y silencio: usa las reglas del municipio real, no un texto genérico."),
    ],
    links: STATE_LINKS,
  };
}

/**
 * Maps a listing's city + street address to Florida STR zoning and tax guidance.
 * Most-specific municipality wins (Miami Beach vs City of Miami vs county).
 */
export function resolveFloridaStrJurisdiction(input: { city: string; address: string }): StrJurisdiction {
  const city = input.city.trim();
  const text = haystack(city, input.address);

  if (includesAny(text, ["sunny isles"])) return sunnyIsles();
  if (includesAny(text, ["miami beach", "south beach", "mid-beach", "midbeach", "north beach"])) {
    return miamiBeach();
  }
  if (includesAny(text, ["brickell", "wynwood", "coconut grove", "downtown miami", "city of miami"])) {
    return cityOfMiami();
  }
  if (includesAny(text, ["fort lauderdale", "ft lauderdale", "ft. lauderdale", "las olas"])) {
    return fortLauderdale();
  }
  if (includesAny(text, ["west palm", "palm beach", "boca raton", "delray", "boynton"])) {
    return palmBeach(city || "Palm Beach County");
  }
  if (
    includesAny(text, [
      "hollywood",
      "pompano",
      "davie",
      "weston",
      "plantation",
      "coral springs",
      "deerfield",
      "broward",
    ])
  ) {
    return browardOther(city || "Broward");
  }
  if (
    includesAny(text, [
      "coral gables",
      "doral",
      "aventura",
      "kendall",
      "homestead",
      "hialeah",
      "miami-dade",
      "miami dade",
    ])
  ) {
    return miamiDadeOther(city || "Miami-Dade");
  }

  const cityKey = city.toLowerCase();
  if (cityKey === "miami beach") return miamiBeach();
  if (cityKey === "brickell") return cityOfMiami();
  if (cityKey === "fort lauderdale") return fortLauderdale();
  if (cityKey === "sunny isles") return sunnyIsles();

  if (includesAny(text, ["collins ave", "ocean dr", "washington ave"])) return miamiBeach();
  if (includesAny(text, ["miami"])) return miamiDadeOther(city || "Miami-Dade");

  return floridaFallback(city);
}
