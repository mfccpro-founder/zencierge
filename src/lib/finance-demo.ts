import type { FinanceOverviewResponse } from "@/lib/finance-types";

function isoOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Sample household used when Postgres is not connected. */
export function getDemoFinancePayload(): FinanceOverviewResponse {
  const fpl = isoOffset(2);
  const chase = isoOffset(5);
  const insurance = isoOffset(6);

  return {
    demo: true,
    overview: {
      userId: "demo-user",
      liquidNetWorth: 18420.55,
      totalDebt: 12680.4,
      overallCreditUtilizationPercent: 34.2,
      cardUtilizations: [
        {
          accountId: "card-chase",
          name: "Chase Freedom",
          balance: 2140,
          creditLimit: 8500,
          utilizationPercent: 25.18,
          overThirtyPercent: false,
        },
        {
          accountId: "card-amex",
          name: "Amex Blue Cash",
          balance: 3120.4,
          creditLimit: 6000,
          utilizationPercent: 52.01,
          overThirtyPercent: true,
        },
        {
          accountId: "card-citi",
          name: "Citi Double Cash",
          balance: 890,
          creditLimit: 4000,
          utilizationPercent: 22.25,
          overThirtyPercent: false,
        },
      ],
      upcomingDue: [
        {
          kind: "recurring_bill",
          id: "bill-fpl",
          title: "Electricidad / FPL",
          amount: 186.4,
          dueDate: fpl,
          daysUntil: 2,
        },
        {
          kind: "credit_card",
          id: "card-chase",
          title: "Chase Freedom",
          amount: 2140,
          dueDate: chase,
          daysUntil: 5,
        },
        {
          kind: "recurring_bill",
          id: "bill-insurance",
          title: "Seguro de auto",
          amount: 142,
          dueDate: insurance,
          daysUntil: 6,
        },
      ],
      pendingCycleExpenses: 2148.4,
      availableCashFlow: 16272.15,
    },
    briefing: {
      greeting: "Buenos días, Javier.",
      alertLevel: "WARNING",
      alertCount: 3,
      summaryText:
        "Buenos días, Javier. Hay puntos que vigilar. El líquido es $18,420.55 frente a $12,680.40 de deuda. La utilización general de crédito es del 34.2 por ciento. Amex Blue Cash está al 52.01 por ciento — por encima del 30 por ciento de alerta. Lo próximo: Electricidad / FPL en dos días por $186.40. El flujo de caja disponible de este ciclo es $16,272.15 después de $2,148.40 en gastos pendientes.",
    },
  };
}
