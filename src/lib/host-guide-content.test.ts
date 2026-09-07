import {
  HOST_GUIDE_CONTENT,
  buildHostGuideModules,
  hostGuideModuleCount,
  hostGuideSearchableText,
} from "./host-guide-content";
import { flattenHostNavItems, guideableHostNavItems } from "./host-nav";
import { runHostNavTests } from "./host-nav.test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_ORDER = [
  "overview",
  "calendar",
  "payouts-noi",
  "chargeback-shield",
  "dispute-dossier",
  "properties-access",
  "elena-voice",
  "guest-qr",
  "housekeeping",
  "photo-reports",
  "supplies",
  "team-cleaners",
  "neighbor-shield",
  "guest-dna",
  "laws",
  "settings",
] as const;

function assertLocaleComplete(id: string, lang: "en" | "es", copy: {
  title: string;
  summary: string;
  lifecycle: string[];
  steps: { title: string; body: string }[];
  tips: string[];
}) {
  assert(copy.title.trim().length > 0, `${id} ${lang} title empty`);
  assert(copy.summary.trim().length > 0, `${id} ${lang} summary empty`);
  assert(copy.lifecycle.length >= 1 && copy.lifecycle.every((row) => row.trim().length > 0), `${id} ${lang} lifecycle`);
  assert(copy.steps.length >= 1 && copy.steps.every((step) => step.title.trim() && step.body.trim()), `${id} ${lang} steps`);
  assert(copy.tips.length >= 1 && copy.tips.every((tip) => tip.trim().length > 0), `${id} ${lang} tips`);
}

function assertPrivacy(blob: string, label: string) {
  const text = blob.toLowerCase();
  assert(!/\b\d{3,6}\s*#/.test(text), `${label}: lock-code placeholder`);
  assert(!/sk-[a-z0-9]{8,}/i.test(text), `${label}: api key placeholder`);
  assert(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text), `${label}: email address`);
  assert(!/\b\d{1,5}\s+\w+\s+(street|st\.|ave|avenue|blvd|road|rd\.|calle|avenida)\b/i.test(text), `${label}: street address`);
  assert(!/wifi password|contraseña (de )?wifi|clave wifi/i.test(text), `${label}: wifi password wording`);
  assert(
    !/door code|gate code|lockbox|alarm code|código de la puerta|codigo de la puerta|código del portón|codigo del porton/i.test(
      text,
    ),
    `${label}: unsafe access-secret wording`,
  );
  assert(!/\b(password|passwd|api[_-]?key|contraseña)\s*[:=]/i.test(text), `${label}: credential assignment`);
  assert(!/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(text), `${label}: phone number`);
  assert(!/\b\$\d/.test(text), `${label}: dollar amount`);
  assert(!/\/dashboard\//.test(text), `${label}: duplicated module route`);
}

export function runHostGuideContentTests() {
  runHostNavTests();

  const navItems = guideableHostNavItems();
  const enModules = buildHostGuideModules("en");
  const esModules = buildHostGuideModules("es");
  assert(enModules.length === 16, `expected 16 EN modules, got ${enModules.length}`);
  assert(esModules.length === 16, `expected 16 ES modules, got ${esModules.length}`);
  assert(hostGuideModuleCount() === 16, "hostGuideModuleCount must be 16");
  assert(hostGuideModuleCount() === navItems.length, "count must come from the nav registry");

  assert(!("user-guide" in HOST_GUIDE_CONTENT), "content must not exist for User Guide itself");
  assert(
    flattenHostNavItems().some((item) => item.id === "user-guide"),
    "nav still has a User Guide item",
  );

  const contentKeys = Object.keys(HOST_GUIDE_CONTENT);
  assert(contentKeys.length === navItems.length, "one content record per guideable nav id");
  for (const item of navItems) {
    const article = HOST_GUIDE_CONTENT[item.id];
    assert(Boolean(article), `missing content for ${item.id}`);
    assertLocaleComplete(item.id, "en", article!.en);
    assertLocaleComplete(item.id, "es", article!.es);
    assert(article!.en.lifecycle.length === article!.es.lifecycle.length, `${item.id} lifecycle length mismatch`);
    assert(article!.en.steps.length === article!.es.steps.length, `${item.id} steps length mismatch`);
    assert(article!.en.tips.length === article!.es.tips.length, `${item.id} tips length mismatch`);
  }

  assert(
    enModules.map((mod) => mod.id).join(",") === EXPECTED_ORDER.join(","),
    `module order must match sidebar: ${enModules.map((mod) => mod.id).join(",")}`,
  );
  assert(
    esModules.map((mod) => mod.id).join(",") === navItems.map((item) => item.id).join(","),
    "ES module order must match guideableHostNavItems",
  );

  for (const mod of [...enModules, ...esModules]) {
    const nav = navItems.find((item) => item.id === mod.id);
    assert(Boolean(nav), `nav missing for ${mod.id}`);
    assert(mod.href === nav!.href, `href for ${mod.id} must come from host-nav`);
  }

  const elena = navItems.find((item) => item.id === "elena-voice");
  const qr = navItems.find((item) => item.id === "guest-qr");
  assert(elena!.href !== qr!.href, "query-tab routes must remain distinct");

  const enBlob = hostGuideSearchableText(enModules[0]!);
  const esBlob = hostGuideSearchableText(esModules[0]!);
  assert(/overview|vista general/i.test(enBlob), "EN searchable text missing");
  assert(/vista general/i.test(esBlob), "ES searchable text missing");
  assert(enBlob !== esBlob, "EN and ES searchable text should differ");

  assertPrivacy(JSON.stringify(HOST_GUIDE_CONTENT), "bilingual content");
  assertPrivacy(enModules.map((mod) => hostGuideSearchableText(mod)).join("\n"), "EN modules");
  assertPrivacy(esModules.map((mod) => hostGuideSearchableText(mod)).join("\n"), "ES modules");

  const housekeeping = HOST_GUIDE_CONTENT.housekeeping;
  assert(
    housekeeping.en.steps.some((step) =>
      step.body.includes("Housekeeping Proof lets you create a private link for a cleaner to submit before-and-after photos for one stay."),
    ),
    "EN housekeeping proof explanation",
  );
  assert(
    housekeeping.es.steps.some((step) =>
      step.body.includes("Housekeeping Proof te permite crear un enlace privado para que el personal de limpieza envíe fotos del antes y después de una estadía."),
    ),
    "ES housekeeping proof explanation",
  );
  assert(!/coming soon|próximamente|\/housekeeping\/upload/i.test(`${housekeeping.en.steps.map((step) => step.body).join(" ")} ${housekeeping.es.steps.map((step) => step.body).join(" ")}`), "proof is available and not legacy upload");
}

const isDirectRun = process.argv[1]?.includes("host-guide-content.test");
if (isDirectRun) {
  try {
    runHostGuideContentTests();
    console.log("host-guide-content tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "host-guide-content tests failed");
    process.exitCode = 1;
  }
}
