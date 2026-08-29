export type CreditUtilizationCard = {
  accountId: string;
  name: string;
  balance: number;
  creditLimit: number;
  utilizationPercent: number;
  overThirtyPercent: boolean;
};

export type UpcomingDueItem = {
  kind: "recurring_bill" | "credit_card";
  id: string;
  title: string;
  amount: number | null;
  dueDate: string;
  daysUntil: number;
};

export type FinancialOverview = {
  userId: string;
  liquidNetWorth: number;
  totalDebt: number;
  overallCreditUtilizationPercent: number | null;
  cardUtilizations: CreditUtilizationCard[];
  upcomingDue: UpcomingDueItem[];
  pendingCycleExpenses: number;
  availableCashFlow: number;
};

export type AlertLevel = "OK" | "WARNING" | "CRITICAL";

export type DailyBriefing = {
  greeting: string;
  alertLevel: AlertLevel;
  summaryText: string;
  alertCount: number;
};

export type FinanceOverviewResponse = {
  overview: FinancialOverview;
  briefing: DailyBriefing;
  demo?: boolean;
};
