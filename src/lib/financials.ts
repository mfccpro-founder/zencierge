import { calendarToday } from "@/lib/dashboard-data";

export type StayChannel = "Airbnb" | "Vrbo" | "Direct";
export type FinancialStatus = "completed" | "confirmed" | "payout_pending";
export type FinanceRangeId = "this_month" | "last_quarter" | "ytd";

export type StayTransaction = {
  id: string;
  property_id: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  channel: StayChannel;
  gross_revenue: number;
  cleaning_fee: number;
  platform_fee: number;
  taxes: number;
  net_profit: number;
  status: FinancialStatus;
};

const MS_DAY = 86_400_000;

export function parseIsoDay(iso: string) {
  return Date.parse(`${iso}T00:00:00.000Z`);
}

export function formatIsoDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function nightsOccupied(checkIn: string, checkOut: string) {
  const from = parseIsoDay(checkIn);
  const to = parseIsoDay(checkOut);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0;
  return Math.round((to - from) / MS_DAY);
}

export function overlapNights(
  checkIn: string,
  checkOut: string,
  rangeStart: string,
  rangeEndExclusive: string,
) {
  const start = Math.max(parseIsoDay(checkIn), parseIsoDay(rangeStart));
  const end = Math.min(parseIsoDay(checkOut), parseIsoDay(rangeEndExclusive));
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / MS_DAY);
}

function computeNet(gross: number, cleaning: number, platform: number, taxes: number) {
  return gross - cleaning - platform - taxes;
}

function tx(input: {
  id: string;
  property_id: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  channel: StayChannel;
  gross_revenue: number;
  cleaning_fee: number;
  platform_rate: number;
  tax_rate: number;
  status: FinancialStatus;
}): StayTransaction {
  const platform_fee = Math.round(input.gross_revenue * input.platform_rate);
  const taxes = Math.round(input.gross_revenue * input.tax_rate);
  return {
    id: input.id,
    property_id: input.property_id,
    guest_name: input.guest_name,
    check_in: input.check_in,
    check_out: input.check_out,
    channel: input.channel,
    gross_revenue: input.gross_revenue,
    cleaning_fee: input.cleaning_fee,
    platform_fee,
    taxes,
    net_profit: computeNet(input.gross_revenue, input.cleaning_fee, platform_fee, taxes),
    status: input.status,
  };
}

/** Realistic South Florida stay ledger · current ops date is calendarToday (2026-08-26). */
export const stayTransactions: StayTransaction[] = [
  tx({
    id: "fin-m1",
    property_id: "prop-1",
    guest_name: "Sofia Alvarez",
    check_in: "2026-03-04",
    check_out: "2026-03-09",
    channel: "Airbnb",
    gross_revenue: 1680,
    cleaning_fee: 175,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-m2",
    property_id: "prop-2",
    guest_name: "Owen Blake",
    check_in: "2026-03-12",
    check_out: "2026-03-16",
    channel: "Vrbo",
    gross_revenue: 1240,
    cleaning_fee: 165,
    platform_rate: 0.08,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-m3",
    property_id: "prop-3",
    guest_name: "Camille Dubois",
    check_in: "2026-03-20",
    check_out: "2026-03-27",
    channel: "Airbnb",
    gross_revenue: 1890,
    cleaning_fee: 190,
    platform_rate: 0.14,
    tax_rate: 0.065,
    status: "completed",
  }),
  tx({
    id: "fin-a1",
    property_id: "prop-1",
    guest_name: "Ryan Cole",
    check_in: "2026-04-02",
    check_out: "2026-04-07",
    channel: "Airbnb",
    gross_revenue: 1950,
    cleaning_fee: 175,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-a2",
    property_id: "prop-4",
    guest_name: "Mei Chen",
    check_in: "2026-04-10",
    check_out: "2026-04-14",
    channel: "Direct",
    gross_revenue: 1480,
    cleaning_fee: 180,
    platform_rate: 0.03,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-a3",
    property_id: "prop-2",
    guest_name: "Liam Foster",
    check_in: "2026-04-18",
    check_out: "2026-04-24",
    channel: "Airbnb",
    gross_revenue: 2160,
    cleaning_fee: 165,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-a4",
    property_id: "prop-3",
    guest_name: "Isla Bennett",
    check_in: "2026-04-25",
    check_out: "2026-04-30",
    channel: "Vrbo",
    gross_revenue: 1320,
    cleaning_fee: 190,
    platform_rate: 0.08,
    tax_rate: 0.065,
    status: "completed",
  }),
  tx({
    id: "fin-y1",
    property_id: "prop-1",
    guest_name: "Noah Patel",
    check_in: "2026-05-01",
    check_out: "2026-05-06",
    channel: "Airbnb",
    gross_revenue: 2100,
    cleaning_fee: 175,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-y2",
    property_id: "prop-2",
    guest_name: "Harper Quinn",
    check_in: "2026-05-08",
    check_out: "2026-05-12",
    channel: "Direct",
    gross_revenue: 1380,
    cleaning_fee: 165,
    platform_rate: 0.03,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-y3",
    property_id: "prop-4",
    guest_name: "Diego Vargas",
    check_in: "2026-05-14",
    check_out: "2026-05-20",
    channel: "Airbnb",
    gross_revenue: 2460,
    cleaning_fee: 180,
    platform_rate: 0.14,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-y4",
    property_id: "prop-3",
    guest_name: "Emma Laurent",
    check_in: "2026-05-22",
    check_out: "2026-05-28",
    channel: "Vrbo",
    gross_revenue: 1680,
    cleaning_fee: 190,
    platform_rate: 0.08,
    tax_rate: 0.065,
    status: "completed",
  }),
  tx({
    id: "fin-j1",
    property_id: "prop-1",
    guest_name: "Ava Morales",
    check_in: "2026-06-03",
    check_out: "2026-06-10",
    channel: "Airbnb",
    gross_revenue: 2940,
    cleaning_fee: 175,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-j2",
    property_id: "prop-2",
    guest_name: "Ethan Brooks",
    check_in: "2026-06-06",
    check_out: "2026-06-11",
    channel: "Vrbo",
    gross_revenue: 1850,
    cleaning_fee: 165,
    platform_rate: 0.08,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-j3",
    property_id: "prop-3",
    guest_name: "Léa Martin",
    check_in: "2026-06-14",
    check_out: "2026-06-21",
    channel: "Airbnb",
    gross_revenue: 2310,
    cleaning_fee: 190,
    platform_rate: 0.15,
    tax_rate: 0.065,
    status: "completed",
  }),
  tx({
    id: "fin-j4",
    property_id: "prop-4",
    guest_name: "Jordan Hale",
    check_in: "2026-06-22",
    check_out: "2026-06-27",
    channel: "Direct",
    gross_revenue: 1980,
    cleaning_fee: 180,
    platform_rate: 0.03,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-l1",
    property_id: "prop-1",
    guest_name: "Mia Santos",
    check_in: "2026-07-02",
    check_out: "2026-07-08",
    channel: "Airbnb",
    gross_revenue: 2520,
    cleaning_fee: 175,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-l2",
    property_id: "prop-2",
    guest_name: "Caleb Nguyen",
    check_in: "2026-07-09",
    check_out: "2026-07-14",
    channel: "Airbnb",
    gross_revenue: 2050,
    cleaning_fee: 165,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-l3",
    property_id: "prop-4",
    guest_name: "Nora Klein",
    check_in: "2026-07-11",
    check_out: "2026-07-18",
    channel: "Vrbo",
    gross_revenue: 2730,
    cleaning_fee: 180,
    platform_rate: 0.08,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-l4",
    property_id: "prop-3",
    guest_name: "Hugo Silva",
    check_in: "2026-07-20",
    check_out: "2026-07-26",
    channel: "Direct",
    gross_revenue: 1560,
    cleaning_fee: 190,
    platform_rate: 0.03,
    tax_rate: 0.065,
    status: "completed",
  }),
  tx({
    id: "fin-l5",
    property_id: "prop-1",
    guest_name: "Chloe Park",
    check_in: "2026-07-24",
    check_out: "2026-07-28",
    channel: "Airbnb",
    gross_revenue: 1480,
    cleaning_fee: 175,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-aug1",
    property_id: "prop-1",
    guest_name: "Elena Navarro",
    check_in: "2026-08-03",
    check_out: "2026-08-28",
    channel: "Airbnb",
    gross_revenue: 4250,
    cleaning_fee: 175,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "confirmed",
  }),
  tx({
    id: "fin-aug2",
    property_id: "prop-2",
    guest_name: "James Whitaker",
    check_in: "2026-08-10",
    check_out: "2026-09-01",
    channel: "Airbnb",
    gross_revenue: 3890,
    cleaning_fee: 165,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "payout_pending",
  }),
  tx({
    id: "fin-aug3",
    property_id: "prop-3",
    guest_name: "Ana Ribeiro",
    check_in: "2026-08-01",
    check_out: "2026-08-06",
    channel: "Vrbo",
    gross_revenue: 1420,
    cleaning_fee: 190,
    platform_rate: 0.08,
    tax_rate: 0.065,
    status: "completed",
  }),
  tx({
    id: "fin-aug4",
    property_id: "prop-4",
    guest_name: "Theo March",
    check_in: "2026-08-07",
    check_out: "2026-08-12",
    channel: "Airbnb",
    gross_revenue: 1700,
    cleaning_fee: 180,
    platform_rate: 0.14,
    tax_rate: 0.07,
    status: "completed",
  }),
  tx({
    id: "fin-aug5",
    property_id: "prop-3",
    guest_name: "Priya Shah",
    check_in: "2026-08-14",
    check_out: "2026-08-19",
    channel: "Direct",
    gross_revenue: 1220,
    cleaning_fee: 190,
    platform_rate: 0.03,
    tax_rate: 0.065,
    status: "payout_pending",
  }),
  tx({
    id: "fin-aug6",
    property_id: "prop-4",
    guest_name: "Lucas Romero",
    check_in: "2026-08-18",
    check_out: "2026-08-23",
    channel: "Vrbo",
    gross_revenue: 1580,
    cleaning_fee: 180,
    platform_rate: 0.08,
    tax_rate: 0.07,
    status: "payout_pending",
  }),
  tx({
    id: "fin-sep1",
    property_id: "prop-1",
    guest_name: "Daniel Cruz",
    check_in: "2026-08-29",
    check_out: "2026-09-03",
    channel: "Vrbo",
    gross_revenue: 1680,
    cleaning_fee: 175,
    platform_rate: 0.08,
    tax_rate: 0.07,
    status: "confirmed",
  }),
  tx({
    id: "fin-sep2",
    property_id: "prop-2",
    guest_name: "Priya Shah",
    check_in: "2026-09-02",
    check_out: "2026-09-06",
    channel: "Airbnb",
    gross_revenue: 1640,
    cleaning_fee: 165,
    platform_rate: 0.15,
    tax_rate: 0.07,
    status: "confirmed",
  }),
];

export function monthKey(iso: string) {
  return iso.slice(0, 7);
}

export function addMonths(isoDay: string, delta: number) {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}

export function startOfMonth(isoDay: string) {
  return `${isoDay.slice(0, 7)}-01`;
}

export function startOfNextMonth(isoDay: string) {
  return startOfMonth(addMonths(isoDay, 1));
}

export function rangeFor(id: FinanceRangeId, asOf = calendarToday): { start: string; endExclusive: string; label: string } {
  const year = asOf.slice(0, 4);
  if (id === "this_month") {
    const start = startOfMonth(asOf);
    return { start, endExclusive: startOfNextMonth(asOf), label: "Este mes" };
  }
  if (id === "last_quarter") {
    return { start: `${year}-04-01`, endExclusive: `${year}-07-01`, label: "Último trimestre" };
  }
  return { start: `${year}-01-01`, endExclusive: formatIsoDay(parseIsoDay(asOf) + MS_DAY), label: "Año en curso" };
}

export function previousMonthWindow(asOf = calendarToday) {
  const prev = addMonths(startOfMonth(asOf), -1);
  return { start: startOfMonth(prev), endExclusive: startOfMonth(asOf) };
}

export function inRange(iso: string, start: string, endExclusive: string) {
  return iso >= start && iso < endExclusive;
}

export function filterTransactions(
  rows: StayTransaction[],
  propertyId: string | "all",
  start: string,
  endExclusive: string,
) {
  return rows.filter((row) => {
    if (propertyId !== "all" && row.property_id !== propertyId) return false;
    return row.check_in < endExclusive && row.check_out > start;
  });
}

export function summarizeLedger(
  rows: StayTransaction[],
  rangeStart: string,
  rangeEndExclusive: string,
  propertyCount: number,
) {
  const gross = rows.reduce((sum, row) => sum + row.gross_revenue, 0);
  const cleaning = rows.reduce((sum, row) => sum + row.cleaning_fee, 0);
  const platform = rows.reduce((sum, row) => sum + row.platform_fee, 0);
  const taxes = rows.reduce((sum, row) => sum + row.taxes, 0);
  const net = rows.reduce((sum, row) => sum + row.net_profit, 0);
  const nights = rows.reduce(
    (sum, row) => sum + overlapNights(row.check_in, row.check_out, rangeStart, rangeEndExclusive),
    0,
  );
  const spanDays = Math.max(1, nightsOccupied(rangeStart, rangeEndExclusive));
  const capacity = spanDays * Math.max(1, propertyCount);
  const occupancy = nights / capacity;
  const adr = nights > 0 ? gross / nights : 0;
  const pending = rows
    .filter((row) => row.status === "payout_pending")
    .reduce((sum, row) => sum + row.net_profit, 0);
  return { gross, cleaning, platform, taxes, net, nights, occupancy, adr, pending };
}

export type MonthPoint = {
  key: string;
  label: string;
  gross: number;
  net: number;
};

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function monthlySeries(
  rows: StayTransaction[],
  propertyId: string | "all",
  asOf = calendarToday,
  monthsBack = 6,
): MonthPoint[] {
  const endMonth = startOfMonth(asOf);
  const points: MonthPoint[] = [];
  for (let offset = monthsBack - 1; offset >= 0; offset -= 1) {
    const start = addMonths(endMonth, -offset);
    const end = startOfNextMonth(start);
    const monthRows = filterTransactions(rows, propertyId, start, end);
    const monthIndex = Number(start.slice(5, 7)) - 1;
    points.push({
      key: start.slice(0, 7),
      label: MONTH_LABELS[monthIndex] ?? start.slice(5, 7),
      gross: monthRows.reduce((sum, row) => sum + row.gross_revenue, 0),
      net: monthRows.reduce((sum, row) => sum + row.net_profit, 0),
    });
  }
  return points;
}

export function deltaPct(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function statusLabel(status: FinancialStatus) {
  if (status === "completed") return "Pagado";
  if (status === "payout_pending") return "En Tránsito";
  return "Confirmado";
}

export function usd(value: number) {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}$${abs}`;
}

export function csvEscape(value: string | number) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function ledgerToCsv(
  rows: StayTransaction[],
  propertyName: (id: string) => string,
) {
  const header = [
    "check_in",
    "check_out",
    "property",
    "guest_name",
    "channel",
    "gross_revenue",
    "cleaning_fee",
    "platform_fee",
    "taxes",
    "net_profit",
    "status",
  ];
  const lines = rows.map((row) =>
    [
      row.check_in,
      row.check_out,
      propertyName(row.property_id),
      row.guest_name,
      row.channel,
      row.gross_revenue,
      row.cleaning_fee,
      row.platform_fee,
      row.taxes,
      row.net_profit,
      statusLabel(row.status),
    ]
      .map(csvEscape)
      .join(","),
  );
  return `\uFEFF${[header.join(","), ...lines].join("\n")}`;
}
