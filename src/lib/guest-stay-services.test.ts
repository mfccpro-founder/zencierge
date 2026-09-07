import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_STAY_EXTERNAL_LINK_REL,
  GUEST_STAY_EXTERNAL_REFERRER_POLICY,
  GUEST_STAY_SERVICE_CATEGORIES,
  allowlistedGuestStayServiceHrefs,
  isAllowlistedGuestStayServiceHref,
  isExactHttpsHomepage,
} from "./guest-stay-services";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runGuestStayServicesTests() {
  const ids = GUEST_STAY_SERVICE_CATEGORIES.map((category) => category.id);
  assert(ids.length === 9, "exactly nine categories");
  assert(
    ids.join(",") ===
      "transportation,food-delivery,groceries,dining,tours,rental-cars,maps-local-guide,luggage,baby-gear",
    "required category order",
  );
  assert(new Set(ids).size === 9, "stable unique category ids");

  const expectedLabels: Record<string, { en: string; es: string }> = {
    transportation: { en: "Transportation", es: "Transporte" },
    "food-delivery": { en: "Food delivery", es: "Entrega de comida" },
    groceries: { en: "Groceries", es: "Supermercado" },
    dining: { en: "Dining reservations", es: "Reservas de restaurantes" },
    tours: { en: "Tours and attractions", es: "Tours y atracciones" },
    "rental-cars": { en: "Rental cars", es: "Alquiler de autos" },
    "maps-local-guide": { en: "Maps and local guide", es: "Mapas y guía local" },
    luggage: { en: "Luggage", es: "Equipaje" },
    "baby-gear": { en: "Baby gear", es: "Artículos para bebés" },
  };
  for (const category of GUEST_STAY_SERVICE_CATEGORIES) {
    assert(category.label.en === expectedLabels[category.id]?.en, `${category.id} English label`);
    assert(category.label.es === expectedLabels[category.id]?.es, `${category.id} Spanish label`);
  }

  const expectedProviders: Record<string, Array<{ name: string; href: string }>> = {
    transportation: [
      { name: "Uber", href: "https://www.uber.com/" },
      { name: "Lyft", href: "https://www.lyft.com/" },
    ],
    "food-delivery": [
      { name: "DoorDash", href: "https://www.doordash.com/" },
      { name: "Uber Eats", href: "https://www.ubereats.com/" },
    ],
    groceries: [{ name: "Instacart", href: "https://www.instacart.com/" }],
    dining: [
      { name: "OpenTable", href: "https://www.opentable.com/" },
      { name: "Resy", href: "https://resy.com/" },
    ],
    tours: [{ name: "Big Bus Tours", href: "https://www.bigbustours.com/" }],
    "rental-cars": [
      { name: "Enterprise", href: "https://www.enterprise.com/" },
      { name: "Hertz", href: "https://www.hertz.com/" },
    ],
    "maps-local-guide": [{ name: "Google Maps", href: "https://www.google.com/maps" }],
    luggage: [{ name: "Bounce", href: "https://usebounce.com/" }],
    "baby-gear": [{ name: "BabyQuip", href: "https://www.babyquip.com/" }],
  };
  for (const category of GUEST_STAY_SERVICE_CATEGORIES) {
    const providers = expectedProviders[category.id] ?? [];
    assert(category.providers.length === providers.length, `${category.id} provider count`);
    category.providers.forEach((provider, index) => {
      assert(provider.name === providers[index]?.name, `${category.id} provider name`);
      assert(provider.href === providers[index]?.href, `${category.id} provider href`);
    });
  }

  const hrefs = allowlistedGuestStayServiceHrefs();
  assert(hrefs.every((href) => href.startsWith("https://")), "HTTPS only");
  assert(hrefs.every((href) => isExactHttpsHomepage(href)), "exact HTTPS homepages");
  assert(hrefs.every((href) => isAllowlistedGuestStayServiceHref(href)), "allowlist helper accepts registry hrefs");
  assert(new Set(hrefs).size === hrefs.length, "no duplicate URLs");
  assert(
    hrefs.every((href) => !href.includes("?") && !href.includes("#") && !href.includes("@")),
    "no query, fragment, or userinfo",
  );
  assert(
    !hrefs.some((href) => /token|stayid|stay_id|propertyid|property_id|address|password|username/i.test(href)),
    "no token, address, stay/property id, or credentials in hrefs",
  );
  assert(!isAllowlistedGuestStayServiceHref("http://www.uber.com/"), "rejects http");
  assert(!isAllowlistedGuestStayServiceHref("https://www.uber.com/?pickup=1"), "rejects query strings");
  assert(!isAllowlistedGuestStayServiceHref("https://www.uber.com/#city"), "rejects fragments");
  assert(!isAllowlistedGuestStayServiceHref("https://user:pass@www.uber.com/"), "rejects username/password");
  assert(!isAllowlistedGuestStayServiceHref("https://example.com/"), "rejects non-allowlisted hosts");

  assert(GUEST_STAY_EXTERNAL_LINK_REL === "noopener noreferrer", "rel contract");
  assert(GUEST_STAY_EXTERNAL_REFERRER_POLICY === "no-referrer", "referrerPolicy contract");

  const ui = readFileSync(join(process.cwd(), "src/components/guest/guest-stay-services.tsx"), "utf8");
  assert(ui.includes('target="_self"'), "service links open in the same tab");
  assert(!ui.includes('target="_blank"'), "service links do not open a new tab");
  assert(ui.includes("GUEST_STAY_EXTERNAL_LINK_REL"), "service links keep noopener noreferrer");
  assert(ui.includes("GUEST_STAY_EXTERNAL_REFERRER_POLICY"), "service links keep no-referrer");
  assert(ui.includes("href={provider.href}"), "provider href is used exactly as stored");
  assert(ui.includes("Use Back to return to Zencierge."), "English Back instruction is shown");
  assert(ui.includes("Usa Atrás para regresar a Zencierge."), "Spanish Back instruction is shown");
  assert(ui.indexOf("GUEST_STAY_SERVICES_BACK_COPY") < ui.indexOf("grid grid-cols-1"), "Back copy sits above the service grid");
  assert(!/window\.location|useRouter|redirect|searchParams|location\.href|fetch\(/.test(ui), "no redirect, router, or tracking fetch");
  assert(!/\btoken\b|propertyName|checkIn/.test(ui), "no token or stay data is appended to service links");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-services.test");
if (isDirectRun) {
  try {
    runGuestStayServicesTests();
    console.log("guest-stay-services tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-services tests failed");
    process.exitCode = 1;
  }
}
