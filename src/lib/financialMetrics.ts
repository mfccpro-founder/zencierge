import { AccountType, type Account, type RecurringBill, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreditUtilizationCard, FinancialOverview, UpcomingDueItem } from "@/lib/finance-types";

export type { CreditUtilizationCard, FinancialOverview, UpcomingDueItem };

const MS_DAY = 86_400_000;
const UTILIZATION_ALERT_PERCENT = 30;

function money(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function nextDateForDayOfMonth(day: number, from: Date): Date {
  const requested = Math.min(31, Math.max(1, Math.trunc(day)));
  const year = from.getFullYear();
  const month = from.getMonth();
  const today = startOfDay(from);
  const thisMonthDay = Math.min(requested, lastDayOfMonth(year, month));
  const thisMonth = new Date(year, month, thisMonthDay);
  if (thisMonth >= today) return thisMonth;
  const nextMonthIndex = month + 1;
  const nextYear = nextMonthIndex > 11 ? year + 1 : year;
  const nextMonth = nextMonthIndex % 12;
  return new Date(nextYear, nextMonth, Math.min(requested, lastDayOfMonth(nextYear, nextMonth)));
}

function daysUntil(target: Date, from: Date) {
  const a = startOfDay(from).getTime();
  const b = startOfDay(target).getTime();
  return Math.round((b - a) / MS_DAY);
}

function isoDay(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function billDueDate(bill: RecurringBill, from: Date): Date {
  if (bill.dueDate) {
    const dated = startOfDay(new Date(bill.dueDate));
    if (dated >= startOfDay(from)) return dated;
  }
  return nextDateForDayOfMonth(bill.dueDay, from);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeFinancialOverview(
  userId: string,
  accounts: Account[],
  bills: RecurringBill[],
  now = new Date(),
): FinancialOverview {
  const liquidNetWorth = round2(
    accounts
      .filter((account) => account.type === AccountType.CHECKING || account.type === AccountType.SAVINGS)
      .reduce((sum, account) => sum + money(account.currentBalance), 0),
  );

  const totalDebt = round2(
    accounts
      .filter((account) => account.type === AccountType.CREDIT_CARD || account.type === AccountType.LOAN)
      .reduce((sum, account) => sum + money(account.currentBalance), 0),
  );

  const cards = accounts.filter((account) => account.type === AccountType.CREDIT_CARD);
  const cardUtilizations: CreditUtilizationCard[] = cards
    .map((card) => {
      const balance = money(card.currentBalance);
      const creditLimit = money(card.creditLimit);
      if (creditLimit <= 0) return null;
      const utilizationPercent = round2((balance / creditLimit) * 100);
      return {
        accountId: card.id,
        name: card.name,
        balance: round2(balance),
        creditLimit: round2(creditLimit),
        utilizationPercent,
        overThirtyPercent: utilizationPercent > UTILIZATION_ALERT_PERCENT,
      };
    })
    .filter((row): row is CreditUtilizationCard => row !== null);

  const cardDebt = cardUtilizations.reduce((sum, card) => sum + card.balance, 0);
  const totalLimit = cardUtilizations.reduce((sum, card) => sum + card.creditLimit, 0);
  const overallCreditUtilizationPercent =
    totalLimit > 0 ? round2((cardDebt / totalLimit) * 100) : null;

  const upcomingDue: UpcomingDueItem[] = [];

  for (const bill of bills) {
    if (bill.isPaid) continue;
    const due = billDueDate(bill, now);
    const until = daysUntil(due, now);
    if (until < 0 || until > 7) continue;
    upcomingDue.push({
      kind: "recurring_bill",
      id: bill.id,
      title: bill.title,
      amount: round2(money(bill.amount)),
      dueDate: isoDay(due),
      daysUntil: until,
    });
  }

  for (const card of cards) {
    if (card.dueDay == null) continue;
    const due = nextDateForDayOfMonth(card.dueDay, now);
    const until = daysUntil(due, now);
    if (until < 0 || until > 7) continue;
    upcomingDue.push({
      kind: "credit_card",
      id: card.id,
      title: card.name,
      amount: round2(money(card.currentBalance)),
      dueDate: isoDay(due),
      daysUntil: until,
    });
  }

  upcomingDue.sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title));

  const month = now.getMonth();
  const year = now.getFullYear();
  const pendingCycleExpenses = round2(
    bills
      .filter((bill) => {
        if (bill.isPaid) return false;
        const due = billDueDate(bill, now);
        return due.getMonth() === month && due.getFullYear() === year;
      })
      .reduce((sum, bill) => sum + money(bill.amount), 0),
  );

  const availableCashFlow = round2(liquidNetWorth - pendingCycleExpenses);

  return {
    userId,
    liquidNetWorth,
    totalDebt,
    overallCreditUtilizationPercent,
    cardUtilizations,
    upcomingDue,
    pendingCycleExpenses,
    availableCashFlow,
  };
}

export async function getFinancialOverview(userId: string): Promise<FinancialOverview> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: true, recurringBills: true },
  });
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }
  return computeFinancialOverview(user.id, user.accounts, user.recurringBills);
}

export async function getUserFinanceContext(userId: string): Promise<{
  user: User;
  overview: FinancialOverview;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: true, recurringBills: true },
  });
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }
  return {
    user,
    overview: computeFinancialOverview(user.id, user.accounts, user.recurringBills),
  };
}
