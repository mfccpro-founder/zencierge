import { guideableHostNavItems, type HostNavItem } from "@/lib/host-nav";

export type GuideLang = "en" | "es";

export type HostGuideLocaleCopy = {
  title: string;
  summary: string;
  lifecycle: string[];
  steps: { title: string; body: string }[];
  tips: string[];
};

export type HostGuideArticle = {
  en: HostGuideLocaleCopy;
  es: HostGuideLocaleCopy;
};

export type HostGuideModule = HostGuideLocaleCopy & {
  id: string;
  href: string;
};

export const HOST_GUIDE_LANG_KEY = "zencierge.hostGuide.lang";
export const HOST_GUIDE_LANG_EVENT = "zencierge-host-guide-lang";

export const HOST_GUIDE_UI = {
  en: {
    searchPlaceholder: "Search the knowledge base (module, step, or tip)...",
    toc: "Table of contents",
    lifecycle: "Lifecycle",
    steps: "Step by step",
    tips: "Pro tips",
    openModule: "Open module",
    emptySearch: "No guide sections match that search. Try a module name such as Housekeeping or Elena Voice.",
    langLabel: "Guide language",
    english: "English",
    spanish: "Español",
    startTour: "Start Guided Tour",
    explainPage: "Explain This Page",
    listen: "Listen",
  },
  es: {
    searchPlaceholder: "Busca en la guía (módulo, paso o consejo)...",
    toc: "Índice",
    lifecycle: "Ciclo de trabajo",
    steps: "Paso a paso",
    tips: "Consejos",
    openModule: "Abrir módulo",
    emptySearch: "Ninguna sección coincide con esa búsqueda. Prueba un nombre como Housekeeping o Elena Voice.",
    langLabel: "Idioma de la guía",
    english: "English",
    spanish: "Español",
    startTour: "Iniciar recorrido",
    explainPage: "Explicar esta página",
    listen: "Escuchar",
  },
} as const;

function locale(article: HostGuideArticle, lang: GuideLang): HostGuideLocaleCopy {
  return lang === "es" ? article.es : article.en;
}

/** Procedural copy keyed by HostNavItem.id. No hrefs — those come from host-nav. */
export const HOST_GUIDE_CONTENT: Record<string, HostGuideArticle> = {
  overview: {
    en: {
      title: "Overview",
      summary:
        "Your Host OS home. Scan live operations, upcoming stays, and alerts, then jump to the tool that needs attention.",
      lifecycle: [
        "Sign in and open Overview from Command Center.",
        "Scan occupancy, calls, and turnover status across listings.",
        "Use cards and shortcuts to open Calendar, Housekeeping, or Elena Voice.",
        "Return here after a busy day to confirm nothing is still red.",
      ],
      steps: [
        {
          title: "Open Overview",
          body: "In the sidebar, under Command Center, choose Overview. This is the Host OS home, not a nested tab.",
        },
        {
          title: "Read the board first",
          body: "Check upcoming check-ins, open operations, and any NeighborShield or housekeeping flags before you dive into one listing.",
        },
        {
          title: "Jump to the working tool",
          body: "Use the sidebar (or on-page shortcuts) to open the matching module. Overview does not replace Properties, Housekeeping, or Settings.",
        },
      ],
      tips: [
        "Treat Overview as a triage desk: fix the urgent item, then come back.",
        "If a card looks empty, confirm the listing exists under Properties & access.",
      ],
    },
    es: {
      title: "Vista general",
      summary:
        "La pantalla de inicio de Host OS. Revisa operaciones en vivo, próximas estadías y alertas, y entra al módulo que requiera atención.",
      lifecycle: [
        "Inicia sesión y abre Vista general en Command Center.",
        "Revisa ocupación, llamadas y estado de turnover en tus anuncios.",
        "Usa las tarjetas o el menú para abrir Calendar, Housekeeping o Elena Voice.",
        "Vuelve al final del día para confirmar que no quedó nada urgente.",
      ],
      steps: [
        {
          title: "Abrir Vista general",
          body: "En la barra lateral, bajo Command Center, elige Overview. Es la pantalla de inicio de Host OS, no una pestaña anidada.",
        },
        {
          title: "Lee el tablero primero",
          body: "Revisa check-ins próximos, operaciones abiertas y cualquier alerta de NeighborShield o Housekeeping antes de entrar a un solo anuncio.",
        },
        {
          title: "Salta al módulo de trabajo",
          body: "Usa la barra lateral (o los atajos de la página) para abrir el módulo correcto. Overview no sustituye Properties, Housekeeping ni Settings.",
        },
      ],
      tips: [
        "Trata Overview como mesa de triaje: resuelve lo urgente y regresa.",
        "Si una tarjeta se ve vacía, confirma que el anuncio existe en Properties & access.",
      ],
    },
  },
  calendar: {
    en: {
      title: "Calendar",
      summary:
        "Reservations and turnover windows for your listings. Use it to see who arrives, who leaves, and when cleaners need the unit.",
      lifecycle: [
        "Bookings appear from your connected calendars.",
        "Review check-in and check-out windows by day.",
        "Plan housekeeping around those windows.",
        "Watch for overlaps so two stays never share a night.",
      ],
      steps: [
        {
          title: "Open Calendar",
          body: "In Command Center, choose Calendar. Select the listing or date range you need.",
        },
        {
          title: "Confirm stay windows",
          body: "Check arrival and departure times before you assign a cleaner or send a guest message.",
        },
        {
          title: "Connect feeds in Properties",
          body: "iCal and channel sync are managed on the listing, not by typing dates into this guide. Open Properties & access if a calendar looks stale.",
        },
      ],
      tips: [
        "A blocked night on Calendar should match what guests see on the OTA.",
        "Use Housekeeping next to turn a checkout into a ready unit.",
      ],
    },
    es: {
      title: "Calendario",
      summary:
        "Reservas y ventanas de turnover de tus anuncios. Sirve para ver quién llega, quién sale y cuándo el equipo de limpieza necesita la unidad.",
      lifecycle: [
        "Las reservas aparecen desde los calendarios conectados.",
        "Revisa ventanas de check-in y check-out por día.",
        "Planifica Housekeeping alrededor de esas ventanas.",
        "Vigila cruces para que dos estadías no compartan la misma noche.",
      ],
      steps: [
        {
          title: "Abrir Calendario",
          body: "En Command Center, elige Calendar. Selecciona el anuncio o el rango de fechas que necesitas.",
        },
        {
          title: "Confirma las ventanas de estadía",
          body: "Revisa horarios de llegada y salida antes de asignar limpieza o escribirle al huésped.",
        },
        {
          title: "Conecta los feeds en Properties",
          body: "La sincronización iCal y de canales se gestiona en el anuncio, no escribiendo fechas en esta guía. Abre Properties & access si el calendario se ve desactualizado.",
        },
      ],
      tips: [
        "Una noche bloqueada en Calendar debe coincidir con lo que ve el huésped en el canal.",
        "Sigue con Housekeeping para dejar la unidad lista después del checkout.",
      ],
    },
  },
  "payouts-noi": {
    en: {
      title: "Payouts & NOI",
      summary:
        "Payouts and net operating view for your listings: occupancy, ADR, and payout status across connected channels.",
      lifecycle: [
        "Reservation revenue and payouts land from connected books.",
        "Review occupancy and ADR by listing.",
        "Reconcile paid versus pending as you close the month.",
        "Use the view when you decide on gaps or rate changes — without copying figures into chat.",
      ],
      steps: [
        {
          title: "Open Payouts & NOI",
          body: "Under Financials, choose Payouts & NOI. Scan portfolio KPIs first, then drill into a listing.",
        },
        {
          title: "Read occupancy with ADR",
          body: "Busy calendars with a falling average daily rate can still shrink profit. Compare both before you cut rates.",
        },
        {
          title: "Label payout status",
          body: "Confirm paid versus pending in this screen so you do not spend money that has not cleared.",
        },
      ],
      tips: [
        "Request a Feature if you need extra P&L lines this view does not show yet.",
        "Compare the same month last year before you react to a shoulder-season dip.",
      ],
    },
    es: {
      title: "Pagos y NOI",
      summary:
        "Vista de pagos y operación neta de tus anuncios: ocupación, ADR y estado de payouts en los canales conectados.",
      lifecycle: [
        "Los ingresos de reserva y los payouts llegan desde la contabilidad conectada.",
        "Revisa ocupación y ADR por anuncio.",
        "Concilia pagado frente a pendiente al cerrar el mes.",
        "Usa esta vista para decidir huecos o tarifas — sin copiar cifras a un chat.",
      ],
      steps: [
        {
          title: "Abrir Pagos y NOI",
          body: "En Financials, elige Payouts & NOI. Revisa primero los indicadores del portafolio y luego entra a un anuncio.",
        },
        {
          title: "Lee ocupación junto con ADR",
          body: "Un calendario lleno con ADR a la baja igual puede recortar la ganancia. Compara ambos antes de bajar tarifas.",
        },
        {
          title: "Marca el estado del payout",
          body: "Confirma pagado frente a pendiente en esta pantalla para no gastar dinero que aún no se acreditó.",
        },
      ],
      tips: [
        "Usa Request a Feature si necesitas líneas de P&L que esta vista todavía no muestra.",
        "Compara el mismo mes del año anterior antes de reaccionar a una temporada baja.",
      ],
    },
  },
  "chargeback-shield": {
    en: {
      title: "Chargeback Shield",
      summary:
        "Automatic dispute defense. Each reservation gets a dossier of signatures, lock-event timestamps, communications, and turnover proofs.",
      lifecycle: [
        "A booking appears on the calendar.",
        "Zencierge compiles signatures, lock events, communications, and turnover proofs into one pack.",
        "Coverage shows complete, partial, or evidence gap.",
        "Download the dossier or open Dispute Dossier to file an AirCover exhibit.",
      ],
      steps: [
        {
          title: "Open Chargeback Shield",
          body: "Under Financials, open Chargeback Shield (nested under Payouts & NOI). Each row is one reservation’s auto-generated pack.",
        },
        {
          title: "Review the evidence blocks",
          body: "Confirm house-rules acceptance, first-unlock timing, Elena/chat history, and housekeeping photos before a guest files a chargeback.",
        },
        {
          title: "Export or file the claim",
          body: "Download the dossier for your records. Use File AirCover exhibit to prefill Dispute Dossier with the same reservation.",
        },
      ],
      tips: [
        "Upcoming stays may show an evidence gap until check-in and the guest gate are complete. That is expected.",
        "Keep lock vendor and verified access records accurate on the listing so audit logs match what actually opened the door.",
      ],
    },
    es: {
      title: "Chargeback Shield",
      summary:
        "Defensa automática ante disputas. Cada reserva arma un expediente con firmas, marcas de tiempo de cerradura, comunicaciones y pruebas de turnover.",
      lifecycle: [
        "Una reserva aparece en el calendario.",
        "Zencierge reúne firmas, eventos de cerradura, comunicaciones y pruebas de turnover en un solo paquete.",
        "La cobertura se muestra completa, parcial o con hueco de evidencia.",
        "Descarga el expediente o abre Dispute Dossier para presentar un exhibit de AirCover.",
      ],
      steps: [
        {
          title: "Abrir Chargeback Shield",
          body: "En Financials, abre Chargeback Shield (anidado bajo Payouts & NOI). Cada fila es el paquete automático de una reserva.",
        },
        {
          title: "Revisa los bloques de evidencia",
          body: "Confirma aceptación de reglas de la casa, horario del primer desbloqueo, historial de Elena/chat y fotos de Housekeeping antes de un chargeback.",
        },
        {
          title: "Exporta o presenta el reclamo",
          body: "Descarga el expediente para tu archivo. Usa File AirCover exhibit para precargar Dispute Dossier con la misma reserva.",
        },
      ],
      tips: [
        "Las estadías próximas pueden mostrar un hueco de evidencia hasta que terminen el check-in y el gate del huésped. Es normal.",
        "Mantén el proveedor de cerradura y los registros de acceso verificado al día en el anuncio para que la bitácora coincida con lo que abrió la puerta.",
      ],
    },
  },
  "dispute-dossier": {
    en: {
      title: "Dispute Dossier",
      summary:
        "Build a forensic exhibit for AirCover or OTA Trust & Safety: identity lock, timeline, mitigation, amount, and a printable evidence index.",
      lifecycle: [
        "Identify the stay (Guest DNA) and the listing.",
        "Record incident date, time, and category (damage, party, smoking, and so on).",
        "Attach photos (including housekeeping pre-clean shots) and NeighborShield timestamps.",
        "Export TXT or print to PDF. Do not edit the exhibit after you upload it to the OTA.",
      ],
      steps: [
        {
          title: "Open Dispute Dossier",
          body: "Under Financials, choose Dispute Dossier. Prefill from a captured guest when possible so names match check-in.",
        },
        {
          title: "Write a neutral narrative",
          body: "Describe what you observed, not what you felt. Include messages sent and calls made (duty to mitigate).",
        },
        {
          title: "Export the pack",
          body: "Use Export Report (.txt) or Print / Save as PDF. The exhibit ID and UTC generated time support chain of custody.",
        },
      ],
      tips: [
        "Housekeeping’s Send to Dispute Dossier button drops the photo caption, timestamp, and file into Evidence attached.",
        "Set category to Property damage when the claim is about checkout condition, not a noise complaint.",
      ],
    },
    es: {
      title: "Dispute Dossier",
      summary:
        "Arma un exhibit forense para AirCover o Trust & Safety del canal: identidad, línea de tiempo, mitigación, monto e índice de evidencia imprimible.",
      lifecycle: [
        "Identifica la estadía (Guest DNA) y el anuncio.",
        "Registra fecha, hora y categoría del incidente (daño, fiesta, humo, etc.).",
        "Adjunta fotos (incluidas las de pre-limpieza de Housekeeping) y marcas de tiempo de NeighborShield.",
        "Exporta TXT o imprime a PDF. No edites el exhibit después de subirlo al canal.",
      ],
      steps: [
        {
          title: "Abrir Dispute Dossier",
          body: "En Financials, elige Dispute Dossier. Precarga desde un huésped capturado cuando sea posible para que los nombres coincidan con el check-in.",
        },
        {
          title: "Escribe una narrativa neutral",
          body: "Describe lo que observaste, no lo que sentiste. Incluye mensajes enviados y llamadas (deber de mitigar).",
        },
        {
          title: "Exporta el paquete",
          body: "Usa Export Report (.txt) o Print / Save as PDF. El ID del exhibit y la hora UTC respaldan la cadena de custodia.",
        },
      ],
      tips: [
        "El botón Send to Dispute Dossier de Housekeeping coloca pie de foto, marca de tiempo y archivo en Evidence attached.",
        "Elige la categoría de daño a la propiedad cuando el reclamo es por condición al checkout, no por ruido.",
      ],
    },
  },
  "properties-access": {
    en: {
      title: "Properties & access",
      summary:
        "Listing command center. Keep occupancy, parking, handbook notes, and verified access information current so Elena and the guest portal stay accurate.",
      lifecycle: [
        "Add or open a listing and confirm check-in and check-out times.",
        "Manage verified access information, smart-lock vendor, parking, and trash instructions in the listing record.",
        "Write the AI handbook in plain language. Elena uses this on guest calls — do not paste secrets into this User Guide.",
        "Share the guest portal from Properties when you want arrivals to self-serve without texting you.",
      ],
      steps: [
        {
          title: "Open Properties & access",
          body: "Under Properties & Smart Locks, choose Properties & access. Select the listing you are updating.",
        },
        {
          title: "Keep access records current",
          body: "Update verified access information the same day you change a lock or network. Do not read access secrets aloud into this guide or into group chats.",
        },
        {
          title: "Refresh the handbook after a house-rule change",
          body: "Quiet hours, occupancy caps, and escalation rules belong in the listing handbook. Short factual sentences work better than marketing copy.",
        },
      ],
      tips: [
        "If a guest reports a lockout, confirm verified access information in Properties before you call them back.",
        "Use Request a Feature if you need a field Elena cannot see yet (for example, EV charger instructions).",
      ],
    },
    es: {
      title: "Propiedades y acceso",
      summary:
        "Centro de mando del anuncio. Mantén ocupación, estacionamiento, notas del handbook e información de acceso verificada al día para que Elena y el portal del huésped coincidan.",
      lifecycle: [
        "Agrega o abre un anuncio y confirma horarios de check-in y check-out.",
        "Gestiona información de acceso verificada, proveedor de cerradura, estacionamiento e instrucciones de basura en el registro del anuncio.",
        "Escribe el handbook de IA en lenguaje claro. Elena lo usa en llamadas — no pegues secretos en esta guía.",
        "Comparte el portal del huésped desde Properties si quieres que las llegadas se autoatiendan sin escribirte.",
      ],
      steps: [
        {
          title: "Abrir Properties & access",
          body: "Bajo Properties & Smart Locks, elige Properties & access. Selecciona el anuncio que vas a actualizar.",
        },
        {
          title: "Mantén los registros de acceso al día",
          body: "Actualiza la información de acceso verificada el mismo día que cambies cerradura o red. No dictes secretos de acceso en esta guía ni en chats grupales.",
        },
        {
          title: "Actualiza el handbook si cambian las reglas",
          body: "Horario de silencio, ocupación máxima y escalamiento van en el handbook del anuncio. Frases cortas y factuales funcionan mejor que el copy de marketing.",
        },
      ],
      tips: [
        "Si un huésped reporta un cierre afuera, confirma la información de acceso verificada en Properties antes de devolver la llamada.",
        "Usa Request a Feature si necesitas un campo que Elena aún no ve (por ejemplo, instrucciones de cargador EV).",
      ],
    },
  },
  "elena-voice": {
    en: {
      title: "Elena Voice",
      summary:
        "Elena, your AI receptionist: studio tools, Test Call, and listing grounding so guests get house rules in the language they spoke.",
      lifecycle: [
        "A guest calls your published voice line.",
        "Elena answers from the listing handbook and verified access policy — not from this User Guide.",
        "Lockouts, leaks, and emergencies escalate to you per Settings.",
        "Open Elena Voice to watch the studio, run a Test Call, and confirm the line shown in the sidebar.",
      ],
      steps: [
        {
          title: "Open Elena Voice",
          body: "Under AI Assistant, choose Elena Voice. This is the main Voice Concierge studio, not the Guest QR tab.",
        },
        {
          title: "Ground Elena in the listing",
          body: "If answers are wrong, update the listing handbook or verified access fields in Properties & access first. Do not only rotate vendor credentials in Settings.",
        },
        {
          title: "Configure the engine in Settings",
          body: "Voice & Phone holds the voice line, vendor credentials (use show/hide), and quiet hours. Test after every credential rotation.",
        },
      ],
      tips: [
        "Quiet hours in Settings should match NeighborShield and the printed house rules.",
        "Never put your personal mobile number in the handbook. Elena should escalate, not publish your cell.",
      ],
    },
    es: {
      title: "Elena Voice",
      summary:
        "Elena, tu recepcionista de IA: estudio, Test Call y contexto del anuncio para que el huésped reciba las reglas de la casa en el idioma que habló.",
      lifecycle: [
        "Un huésped llama a tu línea de voz publicada.",
        "Elena responde con el handbook del anuncio y la política de acceso verificado — no con esta guía.",
        "Cierres afuera, fugas y emergencias escalan a ti según Settings.",
        "Abre Elena Voice para ver el estudio, hacer un Test Call y confirmar la línea que muestra la barra lateral.",
      ],
      steps: [
        {
          title: "Abrir Elena Voice",
          body: "Bajo AI Assistant, elige Elena Voice. Es el estudio principal de Voice Concierge, no la pestaña Guest QR.",
        },
        {
          title: "Ancla a Elena en el anuncio",
          body: "Si las respuestas fallan, actualiza primero el handbook o los campos de acceso verificado en Properties & access. No te limites a rotar credenciales en Settings.",
        },
        {
          title: "Configura el motor en Settings",
          body: "Voice & Phone guarda la línea, las credenciales del proveedor (usa mostrar/ocultar) y el horario de silencio. Prueba después de cada rotación.",
        },
      ],
      tips: [
        "El horario de silencio en Settings debe coincidir con NeighborShield y las reglas impresas.",
        "Nunca pongas tu celular personal en el handbook. Elena debe escalar, no publicar tu número.",
      ],
    },
  },
  "guest-qr": {
    en: {
      title: "Guest QR",
      summary:
        "Guest QR cards for the public guest portal. Print or share the card so arrivals open the right listing without seeing Host OS.",
      lifecycle: [
        "Pick the listing in Elena Voice.",
        "Open the Guest QR row in the sidebar (or the matching tab on the voice page).",
        "Generate or refresh the card for that listing only.",
        "Print or send the card. Guests use the public portal, not the host sidebar.",
      ],
      steps: [
        {
          title: "Open Guest QR",
          body: "Under AI Assistant, choose Guest QR. It is a different sidebar row from Elena Voice, on the same voice page.",
        },
        {
          title: "Select the listing",
          body: "Confirm you are looking at the correct unit before you print. Do not add street addresses or access secrets on the card beyond what the portal already shows the guest.",
        },
        {
          title: "Share the card, not Host OS",
          body: "Guests should never receive a host dashboard link. The QR opens the guest portal for that listing.",
        },
      ],
      tips: [
        "If the QR looks old, refresh it on this tab after you change the listing’s public portal settings.",
        "House rules still live in Properties; this tab only packages the entry point.",
      ],
    },
    es: {
      title: "Guest QR",
      summary:
        "Tarjetas Guest QR para el portal público del huésped. Imprímelas o envíalas para que la llegada abra el anuncio correcto sin ver Host OS.",
      lifecycle: [
        "Elige el anuncio en Elena Voice.",
        "Abre la fila Guest QR en la barra lateral (o la pestaña equivalente en la página de voz).",
        "Genera o actualiza la tarjeta solo para ese anuncio.",
        "Imprime o envía la tarjeta. El huésped usa el portal público, no el menú de anfitrión.",
      ],
      steps: [
        {
          title: "Abrir Guest QR",
          body: "Bajo AI Assistant, elige Guest QR. Es una fila distinta de Elena Voice, en la misma página de voz.",
        },
        {
          title: "Selecciona el anuncio",
          body: "Confirma la unidad correcta antes de imprimir. No agregues direcciones ni secretos de acceso en la tarjeta más allá de lo que el portal ya muestra al huésped.",
        },
        {
          title: "Comparte la tarjeta, no Host OS",
          body: "El huésped nunca debe recibir un enlace del dashboard de anfitrión. El QR abre el portal de ese anuncio.",
        },
      ],
      tips: [
        "Si el QR se ve viejo, actualízalo en esta pestaña después de cambiar el portal público del anuncio.",
        "Las reglas de la casa siguen en Properties; esta pestaña solo empaqueta el punto de entrada.",
      ],
    },
  },
  housekeeping: {
    en: {
      title: "Housekeeping",
      summary:
        "Track every unit through checkout, cleaning, photo inspection, and next arrival. Use the live board, then Photo reports for the gallery.",
      lifecycle: [
        "Guest Checked Out — the guest has departed; the unit is ready for cleaning.",
        "Turnover in Progress — the housekeeper is on-site.",
        "Inspected & Verified — pre/post photos are in with timestamps.",
        "Ready for Check-in — the unit is staged and clear for the next guest.",
      ],
      steps: [
        {
          title: "Open Housekeeping",
          body: "Under Operations, choose Housekeeping (the live board, not Photo reports, Supplies, or Team).",
        },
        {
          title: "Housekeeping Proof",
          body: "Housekeeping Proof lets you create a private link for a cleaner to submit before-and-after photos for one stay. Choose the property, stay, and inspection stage, then send the secure link.",
        },
        {
          title: "Filter the portfolio",
          body: "Use search and status chips (Ready for Check-in, Guest Checked Out, Turnover in Progress, Inspected) to focus a busy day.",
        },
        {
          title: "Hand off photos and claims",
          body: "Open Photo reports for the gallery. On damage shots, use Send to Dispute Dossier so the exhibit builder gets the caption and timestamp.",
        },
      ],
      tips: [
        "Do not crop timestamps out of exports; they are part of your AirCover chain of custody.",
        "If a turnover has no photos yet, ask the cleaner to upload before you mark the unit Ready for Check-in.",
      ],
    },
    es: {
      title: "Housekeeping",
      summary:
        "Sigue cada unidad desde el checkout, la limpieza, la inspección fotográfica y la próxima llegada. Usa el tablero en vivo y Photo reports para la galería.",
      lifecycle: [
        "Guest Checked Out — el huésped salió; la unidad está lista para limpiar.",
        "Turnover in Progress — el equipo de limpieza está en sitio.",
        "Inspected & Verified — hay fotos de antes y después con marca de tiempo.",
        "Ready for Check-in — la unidad está lista para el siguiente huésped.",
      ],
      steps: [
        {
          title: "Abrir Housekeeping",
          body: "Bajo Operations, elige Housekeeping (el tablero en vivo, no Photo reports, Supplies ni Team).",
        },
        {
          title: "Housekeeping Proof",
          body: "Housekeeping Proof te permite crear un enlace privado para que el personal de limpieza envíe fotos del antes y después de una estadía. Elige la propiedad, la estadía y la etapa de inspección, y luego envía el enlace seguro.",
        },
        {
          title: "Filtra el portafolio",
          body: "Usa búsqueda y chips de estado (Ready for Check-in, Guest Checked Out, Turnover in Progress, Inspected) para enfocar un día ocupado.",
        },
        {
          title: "Pasa fotos y reclamos",
          body: "Abre Photo reports para la galería. En fotos de daño, usa Send to Dispute Dossier para que el exhibit reciba pie de foto y marca de tiempo.",
        },
      ],
      tips: [
        "No recortes las marcas de tiempo al exportar; forman parte de la cadena de custodia de AirCover.",
        "Si un turnover aún no tiene fotos, pide la carga antes de marcar Ready for Check-in.",
      ],
    },
  },
  "photo-reports": {
    en: {
      title: "Photo reports",
      summary:
        "Inspection gallery for pre-check-in and post-checkout photos. Zoom, timestamp, and send damage into Dispute Dossier.",
      lifecycle: [
        "Cleaner or host uploads photos from the turnover.",
        "You open Photo reports for that listing.",
        "Section A is checkout condition; Section B is turn-ready staging.",
        "Damage shots can be sent to Dispute Dossier.",
      ],
      steps: [
        {
          title: "Open Photo reports",
          body: "Under Operations, choose Photo reports. This is a separate sidebar row from the Housekeeping live board.",
        },
        {
          title: "Open the inspection gallery",
          body: "On a property card, use View Photos (Pre-Checkin & Post-Checkout). Click a thumbnail to zoom.",
        },
        {
          title: "Send damage to claims",
          body: "On a pre-cleaning photo that shows damage, click Send to Dispute Dossier.",
        },
      ],
      tips: [
        "Timestamps stay with the image. Do not strip them if you export.",
        "Empty galleries mean the cleaner has not uploaded yet — do not invent a ready status.",
      ],
    },
    es: {
      title: "Informes fotográficos",
      summary:
        "Galería de inspección con fotos de pre check-in y post checkout. Amplía, conserva la marca de tiempo y envía daños a Dispute Dossier.",
      lifecycle: [
        "El equipo de limpieza o el anfitrión sube fotos del turnover.",
        "Abres Photo reports para ese anuncio.",
        "La sección A es la condición al checkout; la B es el staging listo.",
        "Las fotos de daño se pueden enviar a Dispute Dossier.",
      ],
      steps: [
        {
          title: "Abrir Photo reports",
          body: "Bajo Operations, elige Photo reports. Es una fila distinta del tablero en vivo de Housekeeping.",
        },
        {
          title: "Abre la galería de inspección",
          body: "En la tarjeta de la propiedad, usa View Photos (Pre-Checkin & Post-Checkout). Toca una miniatura para ampliar.",
        },
        {
          title: "Envía el daño al reclamo",
          body: "En una foto de pre-limpieza con daño, pulsa Send to Dispute Dossier.",
        },
      ],
      tips: [
        "La marca de tiempo se queda con la imagen. No la quites al exportar.",
        "Una galería vacía significa que aún no hay carga — no inventes el estado de listo.",
      ],
    },
  },
  supplies: {
    en: {
      title: "Supplies",
      summary: "Consumables and restock thresholds for turnovers. See what is low before the next check-in.",
      lifecycle: [
        "Listings consume supplies each stay.",
        "This tab shows counts and low-stock flags.",
        "Restock before the next arrival.",
        "Ask cleaners to confirm what they used.",
      ],
      steps: [
        {
          title: "Open Supplies",
          body: "Under Operations, choose Supplies. It is a separate Housekeeping row from the live board.",
        },
        {
          title: "Scan low-stock rows",
          body: "Fix items that will block a ready unit (linens, trash bags, toiletries) before you mark check-in ready.",
        },
        {
          title: "Keep counts honest",
          body: "Update after a restock. Do not type vendor invoices or card numbers into this screen or this guide.",
        },
      ],
      tips: [
        "Pair Supplies with the Housekeeping board on a heavy checkout day.",
        "Request a Feature if you need a purchase-order workflow this tab does not have yet.",
      ],
    },
    es: {
      title: "Suministros",
      summary:
        "Consumibles y umbrales de reposición para el turnover. Ve qué falta antes del próximo check-in.",
      lifecycle: [
        "Cada estadía consume suministros.",
        "Esta pestaña muestra conteos y alertas de stock bajo.",
        "Repón antes de la siguiente llegada.",
        "Pide al equipo de limpieza que confirme lo que usó.",
      ],
      steps: [
        {
          title: "Abrir Supplies",
          body: "Bajo Operations, elige Supplies. Es una fila de Housekeeping distinta del tablero en vivo.",
        },
        {
          title: "Revisa filas de stock bajo",
          body: "Resuelve lo que impida dejar la unidad lista (ropa de cama, bolsas, amenities) antes de marcar check-in listo.",
        },
        {
          title: "Mantén conteos honestos",
          body: "Actualiza después de reponer. No escribas facturas de proveedor ni números de tarjeta en esta pantalla ni en esta guía.",
        },
      ],
      tips: [
        "Combina Supplies con el tablero de Housekeeping en un día de muchos checkouts.",
        "Usa Request a Feature si necesitas órdenes de compra que esta pestaña aún no tiene.",
      ],
    },
  },
  "team-cleaners": {
    en: {
      title: "Team & Cleaners Access",
      summary:
        "Invite cleaning crew or co-hosts and share the public upload link. Role-based access without giving them Host OS admin.",
      lifecycle: [
        "Decide who needs photo upload or turnover access.",
        "Open Team & Cleaners Access.",
        "Invite by role or share the public upload link for phones.",
        "Revoke access when a contractor leaves.",
      ],
      steps: [
        {
          title: "Open Team & Cleaners Access",
          body: "Under Operations, choose Team & Cleaners Access. It is a separate Housekeeping row from the live board.",
        },
        {
          title: "Invite with the least privilege",
          body: "Give cleaners upload or board access only. Do not send them Settings, payout screens, or verified access records.",
        },
        {
          title: "Use the phone-friendly upload link",
          body: "The public upload link is for photos on site. It is not a host login.",
        },
      ],
      tips: [
        "When someone leaves the crew, remove them here the same day.",
        "Photo quality still belongs on Photo reports; this tab is who can upload.",
      ],
    },
    es: {
      title: "Equipo y acceso de limpieza",
      summary:
        "Invita al equipo de limpieza o co-anfitriones y comparte el enlace público de carga. Acceso por rol, sin darles administración de Host OS.",
      lifecycle: [
        "Decide quién necesita subir fotos o ver el turnover.",
        "Abre Team & Cleaners Access.",
        "Invita por rol o comparte el enlace público de carga para el teléfono.",
        "Revoca el acceso cuando un contratista se vaya.",
      ],
      steps: [
        {
          title: "Abrir Team & Cleaners Access",
          body: "Bajo Operations, elige Team & Cleaners Access. Es una fila de Housekeeping distinta del tablero en vivo.",
        },
        {
          title: "Invita con el mínimo privilegio",
          body: "Da al equipo de limpieza solo carga o tablero. No les envíes Settings, pantallas de payouts ni registros de acceso verificado.",
        },
        {
          title: "Usa el enlace de carga para el teléfono",
          body: "El enlace público es para fotos en sitio. No es un inicio de sesión de anfitrión.",
        },
      ],
      tips: [
        "Si alguien sale del equipo, quítalo aquí el mismo día.",
        "La calidad de las fotos se revisa en Photo reports; esta pestaña define quién puede subir.",
      ],
    },
  },
  "neighbor-shield": {
    en: {
      title: "NeighborShield Emergencies",
      summary:
        "Community complaints for noise, parking, and trash — with a one-click house-rules notice to the in-stay guest.",
      lifecycle: [
        "A neighbor or HOA reports an issue.",
        "You log the complaint against the listing and stay window.",
        "Send the in-stay guest a house-rules notice in one click.",
        "Keep the timestamped trail for quiet-hours enforcement and, if needed, Dispute Dossier.",
      ],
      steps: [
        {
          title: "Open NeighborShield Emergencies",
          body: "Under Operations, choose NeighborShield Emergencies. Review open complaints and which listing they belong to.",
        },
        {
          title: "Notify the in-stay guest",
          body: "Use the house-rules notice so the guest of record is told to stop the violation. Do this before you escalate to the OTA.",
        },
        {
          title: "Attach to a claim if it continues",
          body: "Copy complaint times into Dispute Dossier evidence notes. AirCover expects a duty-to-mitigate trail.",
        },
      ],
      tips: [
        "Quiet hours in Settings should match what you print in the handbook and what NeighborShield enforces.",
        "Never argue with a neighbor in the guest thread. Keep the guest notice factual and short.",
      ],
    },
    es: {
      title: "NeighborShield Emergencias",
      summary:
        "Quejas de la comunidad por ruido, estacionamiento y basura, con aviso de reglas de la casa en un clic al huésped en estadía.",
      lifecycle: [
        "Un vecino o la HOA reporta un incidente.",
        "Registras la queja contra el anuncio y la ventana de estadía.",
        "Envías al huésped en casa un aviso de reglas en un clic.",
        "Conservas la pista con marca de tiempo para silencio y, si hace falta, Dispute Dossier.",
      ],
      steps: [
        {
          title: "Abrir NeighborShield Emergencies",
          body: "Bajo Operations, elige NeighborShield Emergencies. Revisa quejas abiertas y a qué anuncio pertenecen.",
        },
        {
          title: "Avisa al huésped en estadía",
          body: "Usa el aviso de reglas para que el huésped de registro deje de incumplir. Hazlo antes de escalar al canal.",
        },
        {
          title: "Adjunta al reclamo si continúa",
          body: "Copia horarios de la queja en las notas de evidencia de Dispute Dossier. AirCover espera rastro de mitigación.",
        },
      ],
      tips: [
        "El horario de silencio en Settings debe coincidir con el handbook impreso y con lo que aplica NeighborShield.",
        "Nunca discutas con un vecino en el hilo del huésped. El aviso debe ser breve y factual.",
      ],
    },
  },
  "guest-dna": {
    en: {
      title: "Guest DNA",
      summary:
        "Identity and risk captured at the guest check-in gate. Use it as the stay record and as a direct-booking pipeline — without copying personal data into this guide.",
      lifecycle: [
        "Guest opens the property QR / verification flow.",
        "ID and selfie (where required) lock identity for the stay.",
        "Zencierge stores the capture on the stay record inside Guest DNA.",
        "Risk tags (chargeback, false dispute, watch, clear) help you decide on future bookings.",
      ],
      steps: [
        {
          title: "Open Guest DNA",
          body: "Under Operations, choose Guest DNA. Review guests captured at the gate, not only names from the OTA inbox.",
        },
        {
          title: "Read risk tags first",
          body: "Chargeback and false-dispute tags are early warning. Pair them with NeighborShield and Dispute Dossier if the same stay goes sideways.",
        },
        {
          title: "Prefill a claim",
          body: "In Dispute Dossier, use Prefill from captured guest so the forensic report uses the legal identity captured at check-in.",
        },
      ],
      tips: [
        "After a five-star stay, contact details live here for a legitimate follow-up — do not scrape OTA inboxes into spreadsheets.",
        "If a guest never completed verification, treat access as incomplete until the gate is done.",
      ],
    },
    es: {
      title: "Guest DNA",
      summary:
        "Identidad y riesgo capturados en el gate de check-in. Úsalo como expediente de la estadía y como canal de reserva directa — sin copiar datos personales a esta guía.",
      lifecycle: [
        "El huésped abre el QR / flujo de verificación del anuncio.",
        "ID y selfie (si aplica) cierran la identidad de la estadía.",
        "Zencierge guarda la captura en el expediente de Guest DNA.",
        "Las etiquetas de riesgo (chargeback, disputa falsa, watch, clear) ayudan a decidir reservas futuras.",
      ],
      steps: [
        {
          title: "Abrir Guest DNA",
          body: "Bajo Operations, elige Guest DNA. Revisa huéspedes capturados en el gate, no solo nombres del inbox del canal.",
        },
        {
          title: "Lee primero las etiquetas de riesgo",
          body: "Chargeback y disputa falsa son alerta temprana. Combínalas con NeighborShield y Dispute Dossier si la misma estadía se complica.",
        },
        {
          title: "Precarga un reclamo",
          body: "En Dispute Dossier, usa Prefill from captured guest para que el informe use la identidad legal del check-in.",
        },
      ],
      tips: [
        "Después de una estadía de cinco estrellas, los datos de contacto viven aquí para un seguimiento legítimo — no extraigas bandejas del canal a hojas de cálculo.",
        "Si el huésped nunca terminó la verificación, trata el acceso como incompleto hasta cerrar el gate.",
      ],
    },
  },
  laws: {
    en: {
      title: "Airbnb Regulations & Laws",
      summary:
        "Airbnb regulations and local-law notes for hosts. Read the published guidance here; it is not a substitute for counsel.",
      lifecycle: [
        "Open Airbnb Regulations & Laws from Legal.",
        "Read the section that matches your question (short-term rental, taxes, quiet hours).",
        "Align listing handbook and Settings quiet hours with what you must follow.",
        "Ask counsel when a rule is unclear — this tab does not file paperwork for you.",
      ],
      steps: [
        {
          title: "Open Airbnb Regulations & Laws",
          body: "Under Legal, choose Airbnb Regulations & Laws. User Guide is a separate sidebar item and is not this page.",
        },
        {
          title: "Match the listing to the rule",
          body: "Apply city and platform rules in Properties handbook language. Do not paste legal opinions into guest messages.",
        },
        {
          title: "Keep operations consistent",
          body: "NeighborShield notices and quiet hours in Settings should not contradict what this page describes.",
        },
      ],
      tips: [
        "Request a Feature (still under Legal) if you need a jurisdiction this page does not cover.",
        "This module does not replace an attorney.",
      ],
    },
    es: {
      title: "Regulaciones y leyes de Airbnb",
      summary:
        "Notas de regulaciones de Airbnb y normas locales para anfitriones. Lee la guía publicada aquí; no sustituye asesoría legal.",
      lifecycle: [
        "Abre Airbnb Regulations & Laws desde Legal.",
        "Lee la sección que corresponde a tu pregunta (alquiler de corta estancia, impuestos, horario de silencio).",
        "Alinea el handbook del anuncio y el silencio de Settings con lo que debes cumplir.",
        "Consulta a un abogado si la norma no está clara — esta pestaña no presenta trámites por ti.",
      ],
      steps: [
        {
          title: "Abrir Airbnb Regulations & Laws",
          body: "Bajo Legal, elige Airbnb Regulations & Laws. User Guide es otro ítem de la barra y no es esta página.",
        },
        {
          title: "Alinea el anuncio con la norma",
          body: "Aplica reglas de ciudad y de plataforma en el lenguaje del handbook de Properties. No pegues opiniones legales en mensajes al huésped.",
        },
        {
          title: "Mantén operaciones coherentes",
          body: "Los avisos de NeighborShield y el silencio en Settings no deben contradecir lo que describe esta página.",
        },
      ],
      tips: [
        "Usa Request a Feature (sigue bajo Legal) si necesitas una jurisdicción que esta página no cubre.",
        "Este módulo no sustituye a un abogado.",
      ],
    },
  },
  settings: {
    en: {
      title: "Settings",
      summary:
        "Account, voice and phone, notifications and escalations, and plan & billing. This is where the voice line, quiet hours, and subscription live.",
      lifecycle: [
        "Confirm account identity and subscription status on the Account and Plan tabs.",
        "Set the voice line and vendor credentials under Voice & Phone (show/hide secrets).",
        "Turn on SMS or WhatsApp alerts and your emergency callback number.",
        "Enable quiet hours so Elena and alerts respect the window you configure.",
      ],
      steps: [
        {
          title: "Open Settings",
          body: "Use the standalone Settings item at the bottom of the sidebar (after User Guide). Tabs cover Account, Voice & Phone, Notifications & Escalations, and Plan & Billing.",
        },
        {
          title: "Save voice credentials carefully",
          body: "Rotate keys in the vendor dashboard, then paste them here. Use show/hide when someone is looking over your shoulder. Never paste credentials into this User Guide.",
        },
        {
          title: "Watch usage before peak weekends",
          body: "Plan & Billing shows your current tier and voice-minute cap. Upgrade only when you need the higher cap.",
        },
      ],
      tips: [
        "After changing quiet hours, update the listing handbook so Elena and printed house rules match.",
        "Use Request a Feature for billing or alert channels Zencierge does not support yet.",
      ],
    },
    es: {
      title: "Ajustes",
      summary:
        "Cuenta, voz y teléfono, notificaciones y escalamiento, y plan y facturación. Aquí viven la línea de voz, el horario de silencio y la suscripción.",
      lifecycle: [
        "Confirma identidad de cuenta y estado de suscripción en las pestañas Account y Plan.",
        "Configura la línea y las credenciales del proveedor en Voice & Phone (mostrar/ocultar secretos).",
        "Activa alertas SMS o WhatsApp y tu número de callback de emergencia.",
        "Activa horario de silencio para que Elena y las alertas respeten la ventana que configures.",
      ],
      steps: [
        {
          title: "Abrir Settings",
          body: "Usa el ítem independiente Settings al final de la barra (después de User Guide). Las pestañas cubren Account, Voice & Phone, Notifications & Escalations y Plan & Billing.",
        },
        {
          title: "Guarda credenciales de voz con cuidado",
          body: "Rota las claves en el panel del proveedor y pégalas aquí. Usa mostrar/ocultar si hay alguien detrás. Nunca pegues credenciales en esta guía.",
        },
        {
          title: "Revisa el uso antes de fines de semana pico",
          body: "Plan & Billing muestra tu nivel actual y el tope de minutos de voz. Mejora de plan solo cuando necesites el tope más alto.",
        },
      ],
      tips: [
        "Si cambias el horario de silencio, actualiza el handbook del anuncio para que Elena y las reglas impresas coincidan.",
        "Usa Request a Feature para facturación o canales de alerta que Zencierge aún no soporta.",
      ],
    },
  },
};

export function hostGuideArticleFor(id: string): HostGuideArticle | undefined {
  return HOST_GUIDE_CONTENT[id];
}

export function hostGuideSearchableText(copy: HostGuideLocaleCopy) {
  return [
    copy.title,
    copy.summary,
    ...copy.lifecycle,
    ...copy.steps.map((step) => `${step.title} ${step.body}`),
    ...copy.tips,
  ].join(" ");
}

export function buildHostGuideModules(
  lang: GuideLang = "en",
  items: HostNavItem[] = guideableHostNavItems(),
): HostGuideModule[] {
  return items.map((item) => {
    const article = HOST_GUIDE_CONTENT[item.id];
    if (!article) {
      throw new Error(`Missing guide content for nav id "${item.id}"`);
    }
    const copy = locale(article, lang);
    return {
      id: item.id,
      href: item.href,
      ...copy,
    };
  });
}

export function hostGuideModuleCount() {
  return guideableHostNavItems().length;
}

export function parseHostGuideLang(value: string | null | undefined): GuideLang {
  return value === "es" ? "es" : "en";
}

export function subscribeHostGuideLang(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === HOST_GUIDE_LANG_KEY || event.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(HOST_GUIDE_LANG_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(HOST_GUIDE_LANG_EVENT, onStoreChange);
  };
}

export function getHostGuideLangSnapshot(): GuideLang {
  if (typeof window === "undefined") return "en";
  try {
    return parseHostGuideLang(window.localStorage.getItem(HOST_GUIDE_LANG_KEY));
  } catch {
    return "en";
  }
}

export function getHostGuideLangServerSnapshot(): GuideLang {
  return "en";
}

export function setHostGuideLang(lang: GuideLang) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOST_GUIDE_LANG_KEY, lang);
  } catch {
    /* private mode — same-tab event still updates the selector */
  }
  window.dispatchEvent(new Event(HOST_GUIDE_LANG_EVENT));
}
