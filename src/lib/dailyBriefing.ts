import type { User } from "@prisma/client";
import { getUserFinanceContext } from "@/lib/financialMetrics";
import type { AlertLevel, DailyBriefing, FinancialOverview } from "@/lib/finance-types";

export type { AlertLevel, DailyBriefing };

function hourInZone(timeZone: string, now: Date) {
  const hourRaw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).format(now);
  const hour = Number.parseInt(hourRaw, 10);
  if (!Number.isFinite(hour)) return now.getHours();
  return hour === 24 ? 0 : hour;
}

function greetingFor(name: string, language: "es" | "en", timeZone: string, now: Date) {
  const hour = hourInZone(timeZone, now);
  if (language === "es") {
    if (hour < 12) return `Buenos días, ${name}.`;
    if (hour < 19) return `Buenas tardes, ${name}.`;
    return `Buenas noches, ${name}.`;
  }
  if (hour < 12) return `Good morning, ${name}.`;
  if (hour < 17) return `Good afternoon, ${name}.`;
  return `Good evening, ${name}.`;
}

function usd(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function alertLevelFromOverview(overview: FinancialOverview): { level: AlertLevel; alertCount: number } {
  const hotCards = overview.cardUtilizations.filter((card) => card.overThirtyPercent);
  const criticalCards = overview.cardUtilizations.filter((card) => card.utilizationPercent >= 80);
  const util = overview.overallCreditUtilizationPercent ?? 0;
  let alertCount = hotCards.length + overview.upcomingDue.length;
  if (overview.availableCashFlow < 0) alertCount += 1;

  if (util >= 80 || criticalCards.length > 0 || (overview.availableCashFlow < 0 && overview.upcomingDue.length > 0)) {
    return { level: "CRITICAL", alertCount };
  }
  if (hotCards.length > 0 || overview.upcomingDue.length > 0 || overview.availableCashFlow < 0 || util >= 50) {
    return { level: "WARNING", alertCount };
  }
  return { level: "OK", alertCount: 0 };
}

export function composeDailyBriefingText(
  user: Pick<User, "name" | "language" | "timezone">,
  overview: FinancialOverview,
  now = new Date(),
): DailyBriefing {
  const language = user.language === "es" ? "es" : "en";
  const greeting = greetingFor(user.name.split(" ")[0] || user.name, language, user.timezone, now);
  const { level, alertCount } = alertLevelFromOverview(overview);
  const firstDue = overview.upcomingDue[0];
  const hottest = [...overview.cardUtilizations].sort((a, b) => b.utilizationPercent - a.utilizationPercent)[0];

  const summaryText =
    language === "es"
      ? composeEs(overview, level, firstDue, hottest)
      : composeEn(overview, level, firstDue, hottest);

  return {
    greeting,
    alertLevel: level,
    summaryText: `${greeting} ${summaryText}`,
    alertCount,
  };
}

function composeEn(
  overview: FinancialOverview,
  level: AlertLevel,
  firstDue: FinancialOverview["upcomingDue"][number] | undefined,
  hottest: FinancialOverview["cardUtilizations"][number] | undefined,
) {
  const util =
    overview.overallCreditUtilizationPercent == null
      ? "Credit utilization is not available because no card limits are on file."
      : `Overall credit utilization is ${overview.overallCreditUtilizationPercent} percent.`;
  const due = firstDue
    ? `Next up: ${firstDue.title} on ${firstDue.dueDate}${firstDue.amount != null ? ` for ${usd(firstDue.amount)}` : ""}.`
    : "You have no bills or card due dates in the next seven days.";
  const cash = `Available cash flow this cycle is ${usd(overview.availableCashFlow)} after ${usd(overview.pendingCycleExpenses)} in unpaid bills, with ${usd(overview.liquidNetWorth)} in checking and savings.`;
  const cardNote =
    hottest?.overThirtyPercent
      ? ` ${hottest.name} is at ${hottest.utilizationPercent} percent — above the 30 percent warning line.`
      : "";
  if (level === "CRITICAL") {
    return `This is a critical money morning. Liquid cash is ${usd(overview.liquidNetWorth)} and total debt is ${usd(overview.totalDebt)}. ${util}${cardNote} ${due} ${cash} Prioritize payments before anything else.`;
  }
  if (level === "WARNING") {
    return `A few items need attention. Liquid cash is ${usd(overview.liquidNetWorth)} against ${usd(overview.totalDebt)} in debt. ${util}${cardNote} ${due} ${cash}`;
  }
  return `You are in good shape. Liquid cash is ${usd(overview.liquidNetWorth)} and total debt is ${usd(overview.totalDebt)}. ${util} ${due} ${cash}`;
}

function composeEs(
  overview: FinancialOverview,
  level: AlertLevel,
  firstDue: FinancialOverview["upcomingDue"][number] | undefined,
  hottest: FinancialOverview["cardUtilizations"][number] | undefined,
) {
  const util =
    overview.overallCreditUtilizationPercent == null
      ? "No hay límites de tarjeta registrados para calcular la utilización."
      : `La utilización general de crédito es del ${overview.overallCreditUtilizationPercent} por ciento.`;
  const due = firstDue
    ? `Lo próximo: ${firstDue.title} el ${firstDue.dueDate}${firstDue.amount != null ? ` por ${usd(firstDue.amount)}` : ""}.`
    : "No tienes facturas ni fechas de corte de tarjetas en los próximos siete días.";
  const cash = `El flujo de caja disponible de este ciclo es ${usd(overview.availableCashFlow)} después de ${usd(overview.pendingCycleExpenses)} en gastos pendientes, con ${usd(overview.liquidNetWorth)} en cheques y ahorros.`;
  const cardNote =
    hottest?.overThirtyPercent
      ? ` ${hottest.name} está al ${hottest.utilizationPercent} por ciento — por encima del 30 por ciento de alerta.`
      : "";
  if (level === "CRITICAL") {
    return `Esta mañana es crítica. El líquido es ${usd(overview.liquidNetWorth)} y la deuda total es ${usd(overview.totalDebt)}. ${util}${cardNote} ${due} ${cash} Prioriza los pagos ahora.`;
  }
  if (level === "WARNING") {
    return `Hay puntos que vigilar. El líquido es ${usd(overview.liquidNetWorth)} frente a ${usd(overview.totalDebt)} de deuda. ${util}${cardNote} ${due} ${cash}`;
  }
  return `Vas bien. El líquido es ${usd(overview.liquidNetWorth)} y la deuda total es ${usd(overview.totalDebt)}. ${util} ${due} ${cash}`;
}

export async function generateDailyBriefing(userId: string): Promise<DailyBriefing> {
  const { user, overview } = await getUserFinanceContext(userId);
  return composeDailyBriefingText(user, overview);
}
