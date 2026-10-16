import type { GuideLang, HostGuideModule } from "@/lib/host-guide-content";

export type SaturdayDemoRequirement =
  | "manual"
  | "request_recorded"
  | "assigned"
  | "evidence_submitted"
  | "completed";

export type SaturdayDemoModule = HostGuideModule & {
  requirement: SaturdayDemoRequirement;
};

export type SaturdayDemoRequest = {
  id: string;
  status: "requested" | "assigned" | "in_progress" | "evidence_submitted" | "completed" | "needs_attention";
  assignedTo: "Demo Housekeeping" | null;
  proofTaskId: string | null;
  createdAt: string;
};

export type SaturdayDemoVerification =
  | { ok: true; requestId: string; message: string }
  | { ok: false; message: string };

const STATUS_ORDER: Record<SaturdayDemoRequest["status"], number> = {
  requested: 0,
  assigned: 1,
  in_progress: 2,
  needs_attention: 2,
  evidence_submitted: 3,
  completed: 4,
};

const COPY = {
  en: [
    {
      id: "overview",
      href: "/dashboard",
      requirement: "manual",
      title: "Welcome to the Saturday demo",
      summary: "Isabela introduces one short, presenter-controlled story. Nothing advances until you choose Continue.",
      steps: [{ title: "Set the scene", body: "A guest is staying at a fictional property and needs two towels." }],
      lifecycle: [], tips: [],
    },
    {
      id: "properties-access",
      href: "/dashboard/properties",
      requirement: "manual",
      title: "Open the mobile guest portal",
      summary: "Ask the guest to open the authorized stay link on the phone, then submit the two-towel request there.",
      steps: [{ title: "Wait for the guest", body: "Continue only after the phone reports that the server registered the request." }],
      lifecycle: [], tips: [],
    },
    {
      id: "housekeeping",
      href: "/dashboard/housekeeping",
      requirement: "request_recorded",
      title: "Verify the towel request",
      summary: "Isabela checks the host server queue and locks this demo to the newly recorded request.",
      steps: [{ title: "Presenter action", body: "Choose Verify on server. A failed or missing read never becomes a success." }],
      lifecycle: [], tips: [],
    },
    {
      id: "housekeeping",
      href: "/dashboard/housekeeping",
      requirement: "assigned",
      title: "Assign Demo Housekeeping",
      summary: "Assign the request and start it in the Housekeeping card, then ask Isabela to verify the server state.",
      steps: [{ title: "Presenter action", body: "The same request must be assigned to Demo Housekeeping before this step passes." }],
      lifecycle: [], tips: [],
    },
    {
      id: "photo-reports",
      href: "/dashboard/housekeeping?tab=reports",
      requirement: "evidence_submitted",
      title: "Submit photo evidence",
      summary: "Use the existing proof flow for this stay. Isabela will verify that evidence was submitted for the same request.",
      steps: [{ title: "Presenter action", body: "Upload and submit the fictional proof, then choose Verify on server." }],
      lifecycle: [], tips: [],
    },
    {
      id: "photo-reports",
      href: "/dashboard/housekeeping?tab=reports",
      requirement: "completed",
      title: "Review and approve",
      summary: "Approve the submitted proof. Completion is confirmed only when the server reports this request as completed.",
      steps: [{ title: "Presenter action", body: "Review the photos, approve them, and then verify the result." }],
      lifecycle: [], tips: [],
    },
    {
      id: "dispute-dossier",
      href: "/dashboard/dispute-dossier",
      requirement: "manual",
      title: "Review the host documentation",
      summary: "Show only evidence actually recorded for the fictional stay. Missing signatures, lock events, inspections, photos, or coverage must read “No registrado.”",
      steps: [{ title: "Close the story", body: "Explain that house rules, platform protection programs, and applicable law are separate sources of protection." }],
      lifecycle: [], tips: [],
    },
  ],
  es: [
    {
      id: "overview", href: "/dashboard", requirement: "manual", title: "Bienvenida a la demo del sábado",
      summary: "Isabela presenta una historia breve controlada por el presentador. Nada avanza hasta que pulses Continuar.",
      steps: [{ title: "Presenta el caso", body: "Un huésped está en una propiedad ficticia y necesita dos toallas." }], lifecycle: [], tips: [],
    },
    {
      id: "properties-access", href: "/dashboard/properties", requirement: "manual", title: "Abre el portal móvil del huésped",
      summary: "Pide al huésped abrir en el teléfono el enlace autorizado de su estancia y enviar allí la solicitud de dos toallas.",
      steps: [{ title: "Espera al huésped", body: "Continúa solo después de que el teléfono indique que el servidor registró la solicitud." }], lifecycle: [], tips: [],
    },
    {
      id: "housekeeping", href: "/dashboard/housekeeping", requirement: "request_recorded", title: "Verifica la solicitud de toallas",
      summary: "Isabela consulta la cola del anfitrión y fija la demo a la solicitud recién registrada.",
      steps: [{ title: "Acción del presentador", body: "Pulsa Verificar en servidor. Una lectura fallida o ausente nunca se presenta como éxito." }], lifecycle: [], tips: [],
    },
    {
      id: "housekeeping", href: "/dashboard/housekeeping", requirement: "assigned", title: "Asigna Demo Housekeeping",
      summary: "Asigna e inicia la solicitud en Housekeeping; después pide a Isabela verificar el estado del servidor.",
      steps: [{ title: "Acción del presentador", body: "La misma solicitud debe estar asignada a Demo Housekeeping para superar este paso." }], lifecycle: [], tips: [],
    },
    {
      id: "photo-reports", href: "/dashboard/housekeeping?tab=reports", requirement: "evidence_submitted", title: "Envía evidencia fotográfica",
      summary: "Usa el flujo de evidencia existente para esta estancia. Isabela verificará el envío para la misma solicitud.",
      steps: [{ title: "Acción del presentador", body: "Carga y envía la prueba ficticia; después pulsa Verificar en servidor." }], lifecycle: [], tips: [],
    },
    {
      id: "photo-reports", href: "/dashboard/housekeeping?tab=reports", requirement: "completed", title: "Revisa y aprueba",
      summary: "Aprueba la evidencia enviada. La finalización solo se confirma cuando el servidor marca esta solicitud como completada.",
      steps: [{ title: "Acción del presentador", body: "Revisa las fotos, apruébalas y verifica el resultado." }], lifecycle: [], tips: [],
    },
    {
      id: "dispute-dossier", href: "/dashboard/dispute-dossier", requirement: "manual", title: "Revisa la documentación del anfitrión",
      summary: "Muestra solo evidencia registrada para la estancia ficticia. Firmas, cerraduras, inspecciones, fotos o cobertura ausentes deben decir “No registrado”.",
      steps: [{ title: "Cierra la historia", body: "Aclara que las reglas de la casa, los programas de protección de plataformas y la ley aplicable son fuentes distintas." }], lifecycle: [], tips: [],
    },
  ],
} satisfies Record<GuideLang, SaturdayDemoModule[]>;

export function buildSaturdayDemoModules(lang: GuideLang): SaturdayDemoModule[] {
  return COPY[lang];
}

function isRequest(value: unknown): value is SaturdayDemoRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.createdAt === "string"
    && ["requested", "assigned", "in_progress", "evidence_submitted", "completed", "needs_attention"].includes(String(row.status))
    && (row.assignedTo === null || row.assignedTo === "Demo Housekeeping")
    && (row.proofTaskId === null || typeof row.proofTaskId === "string");
}

export function parseSaturdayDemoRequests(value: unknown): SaturdayDemoRequest[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const requests = (value as { requests?: unknown }).requests;
  return Array.isArray(requests) && requests.every(isRequest) ? requests : null;
}

export function verifySaturdayDemoStep(
  requirement: SaturdayDemoRequirement,
  requests: SaturdayDemoRequest[],
  trackedRequestId: string | null,
  lang: GuideLang,
  startedAt?: string,
): SaturdayDemoVerification {
  if (requirement === "manual") return { ok: false, message: lang === "es" ? "Este paso requiere la acción del presentador." : "This step requires presenter action." };
  const request = trackedRequestId
    ? requests.find((row) => row.id === trackedRequestId)
    : [...requests]
        .filter((row) => !startedAt || Date.parse(row.createdAt) >= Date.parse(startedAt))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!request) return { ok: false, message: lang === "es" ? "El servidor no devolvió la solicitud de esta demo." : "The server did not return this demo request." };

  const requiredStatus = requirement === "request_recorded" ? 0 : requirement === "assigned" ? 1 : requirement === "evidence_submitted" ? 3 : 4;
  const assignmentMatches = requirement !== "assigned" || request.assignedTo === "Demo Housekeeping";
  const proofMatches = !["evidence_submitted", "completed"].includes(requirement) || Boolean(request.proofTaskId);
  if (STATUS_ORDER[request.status] < requiredStatus || !assignmentMatches || !proofMatches) {
    return { ok: false, message: lang === "es" ? `Estado del servidor aún no válido: ${request.status}.` : `Server state is not ready yet: ${request.status}.` };
  }
  return {
    ok: true,
    requestId: request.id,
    message: lang === "es" ? `Verificado en el servidor: ${request.status}.` : `Verified on the server: ${request.status}.`,
  };
}

export async function fetchSaturdayDemoVerification(input: {
  requirement: SaturdayDemoRequirement;
  trackedRequestId: string | null;
  lang: GuideLang;
  startedAt?: string;
  request?: typeof fetch;
}): Promise<SaturdayDemoVerification> {
  const response = await (input.request ?? fetch)("/api/housekeeping/service-requests", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return { ok: false, message: input.lang === "es" ? `La comprobación del servidor falló (HTTP ${response.status}).` : `Server verification failed (HTTP ${response.status}).` };
  const requests = parseSaturdayDemoRequests(await response.json());
  if (!requests) return { ok: false, message: input.lang === "es" ? "El servidor devolvió una respuesta no válida." : "The server returned an invalid response." };
  return verifySaturdayDemoStep(input.requirement, requests, input.trackedRequestId, input.lang, input.startedAt);
}
