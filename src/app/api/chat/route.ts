import { NextRequest, NextResponse } from "next/server";
import { properties, type Property } from "@/lib/dashboard-data";
import { answerGuestQuestion } from "@/lib/receptionist-replies";

export const runtime = "nodejs";

const FALLBACK_PROPERTY: Property = properties[0];

/** Spanish function words & concierge vocabulary (for language scoring). */
const ES_HINTS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "pero", "porque", "por", "para",
  "con", "sin", "como", "que", "cual", "cuales", "quien", "donde", "cuando", "tambien", "muy",
  "mas", "menos", "hay", "tiene", "tengo", "necesito", "quiero", "puedo", "dame", "esta", "estoy",
  "estamos", "soy", "eres", "somos", "gracias", "hola", "buenos", "buenas", "dias", "noches",
  "tardes", "favor", "clave", "contrasena", "puerta", "estacionamiento", "parqueo", "cochera",
  "porton", "farmacia", "supermercado", "mercado", "tienda", "restaurante", "comida", "reglas",
  "silencio", "basura", "ruido", "fuga", "inundacion", "emergencia", "ayuda", "horario", "entrada",
  "salida", "cuanto", "cuantos", "decir", "habla", "hablo", "hablamos", "llave", "codigo",
  "cerradura", "cerca", "cercano", "caminar", "minutos", "playa", "ciudad", "direccion",
  "anfitrion", "huesped", "reserva", "noche", "noches", "dia", "dias", "puedes", "quisiera",
  "wifi", "uber", "taxi", "check", "smartlock", "numero", "me", "te", "se", "es", "estan",
  "estas", "del", "al",
]);

/** English function words & concierge vocabulary (for language scoring). */
const EN_HINTS = new Set([
  "the", "and", "or", "but", "because", "for", "with", "without", "how", "what", "who", "where",
  "when", "why", "also", "very", "more", "less", "there", "is", "are", "do", "does", "can",
  "could", "would", "will", "you", "we", "they", "need", "want", "have", "has", "get", "please",
  "thanks", "thank", "hello", "hi", "hey", "password", "parking", "garage", "gate", "pharmacy",
  "supermarket", "grocery", "store", "market", "restaurant", "food", "rules", "quiet", "noise",
  "trash", "leak", "flood", "emergency", "help", "check", "checkout", "checkin", "door", "code",
  "key", "smartlock", "internet", "network", "near", "nearby", "walk", "minutes", "airport",
  "uber", "taxi", "beach", "city", "address", "host", "guest", "guests", "reservation", "night",
  "nights", "day", "days", "tell", "show", "give", "know", "around", "much", "many", "my", "this",
  "that", "it", "to", "in", "on", "at", "from", "of", "about", "whats", "hows", "great", "number",
  "room", "pool", "towels", "clean", "cleaning", "stay", "book", "booking", "me",
]);

/**
 * Detect whether the incoming message is mostly English or Spanish.
 * Strong Spanish markers (¿ ¡ or accented letters) win immediately. Spanish is the
 * default: English is only returned when English keywords clearly outnumber Spanish
 * ones. Ties and unknown words resolve to Spanish.
 */
function detectLang(text: string): "en" | "es" {
  if (/[¿¡]/.test(text)) return "es";
  if (/[áéíóúüñ]/.test(text.toLowerCase())) return "es";

  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ");
  const words = normalized.split(/\s+/).filter((word) => word.length >= 2);

  let esScore = 0;
  let enScore = 0;
  for (const word of words) {
    if (ES_HINTS.has(word)) esScore += 1;
    if (EN_HINTS.has(word)) enScore += 1;
  }

  return enScore > esScore && enScore > 0 ? "en" : "es";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: string;
      propertyId?: string;
      history?: Array<{ role: "user" | "assistant"; content?: string }>;
    };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const property = properties.find((p) => p.id === body.propertyId) ?? FALLBACK_PROPERTY;
    const lang = detectLang(message);

    const history: Array<{ role: "user" | "assistant"; content: string }> = Array.isArray(
      body.history,
    )
      ? body.history
          .filter((turn) => turn && typeof turn.content === "string")
          .map((turn) => ({
            role: turn.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: String(turn.content).slice(0, 600).trim(),
          }))
          .filter((turn) => turn.content.length > 0)
          .slice(-8)
      : [];

    const reply = answerGuestQuestion({
      question: message,
      properties,
      fallback: property,
      language: lang,
      history,
    });

    return NextResponse.json({ reply, lang });
  } catch (cause) {
    console.error("[chat] failed to generate reply", cause);
    return NextResponse.json({ error: "Could not generate reply" }, { status: 500 });
  }
}