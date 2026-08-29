import { randomUUID } from "node:crypto";
import { ZENCIERGE_PLAN_IDS, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

export type SquareSubStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIAL";
export type FunnelEventType = "upgrade_click" | "checkout_started" | "paid";
export type HostFilter = "all" | "active" | "pending" | "canceled";

export type AdminHostRow = {
  id: string;
  name: string;
  email: string;
  planId: ZenciergePlanId;
  status: SquareSubStatus;
  monthlyUsd: number;
  lastPaymentAt: string | null;
  activeProperties: number;
  squareCustomerId: string;
};

export type FunnelEvent = {
  id: string;
  at: string;
  type: FunnelEventType;
  planId: ZenciergePlanId;
  source: "landing" | "settings" | "checkout" | "webhook";
  email?: string;
};

export type SquareCharge = {
  id: string;
  at: string;
  amountUsd: number;
  status: "SUCCESS" | "FAILED" | "PENDING";
  email?: string;
  planId?: ZenciergePlanId;
  squarePaymentId: string;
};

const seedHosts: AdminHostRow[] = [
  {
    id: "host-1",
    name: "Javier Murphy",
    email: "javier@zencierge.app",
    planId: "pro",
    status: "ACTIVE",
    monthlyUsd: 99,
    lastPaymentAt: "2026-08-01T14:12:00.000Z",
    activeProperties: 4,
    squareCustomerId: "SQCUS_JM_8F2K",
  },
  {
    id: "host-2",
    name: "Camila Reyes",
    email: "camila@miamibeachloft.com",
    planId: "starter",
    status: "ACTIVE",
    monthlyUsd: 49,
    lastPaymentAt: "2026-08-03T09:40:00.000Z",
    activeProperties: 1,
    squareCustomerId: "SQCUS_CR_1A9P",
  },
  {
    id: "host-3",
    name: "Andre Walsh",
    email: "andre@brickellops.com",
    planId: "agency",
    status: "ACTIVE",
    monthlyUsd: 199,
    lastPaymentAt: "2026-08-05T16:02:00.000Z",
    activeProperties: 11,
    squareCustomerId: "SQCUS_AW_7Q3M",
  },
  {
    id: "host-4",
    name: "Sofia Alvarez",
    email: "sofia@ftlauderdale.host",
    planId: "pro",
    status: "PAST_DUE",
    monthlyUsd: 99,
    lastPaymentAt: "2026-07-04T11:18:00.000Z",
    activeProperties: 3,
    squareCustomerId: "SQCUS_SA_4D2R",
  },
  {
    id: "host-5",
    name: "Owen Blake",
    email: "owen@wynwoodstays.com",
    planId: "starter",
    status: "TRIAL",
    monthlyUsd: 49,
    lastPaymentAt: null,
    activeProperties: 1,
    squareCustomerId: "SQCUS_OB_TRIAL",
  },
  {
    id: "host-6",
    name: "Mei Chen",
    email: "mei@keysvacay.com",
    planId: "pro",
    status: "CANCELED",
    monthlyUsd: 99,
    lastPaymentAt: "2026-06-11T19:22:00.000Z",
    activeProperties: 0,
    squareCustomerId: "SQCUS_MC_CXL",
  },
  {
    id: "host-7",
    name: "Hugo Silva",
    email: "hugo@coralhost.co",
    planId: "starter",
    status: "CANCELED",
    monthlyUsd: 49,
    lastPaymentAt: "2026-08-09T08:05:00.000Z",
    activeProperties: 0,
    squareCustomerId: "SQCUS_HS_CXL",
  },
  {
    id: "host-8",
    name: "Nora Klein",
    email: "nora@lasolasair.com",
    planId: "agency",
    status: "ACTIVE",
    monthlyUsd: 199,
    lastPaymentAt: "2026-08-12T13:44:00.000Z",
    activeProperties: 8,
    squareCustomerId: "SQCUS_NK_2L8C",
  },
];

const seedFunnel: FunnelEvent[] = [
  { id: "fn-1", at: "2026-08-26T15:04:00.000Z", type: "upgrade_click", planId: "pro", source: "landing", email: "sofia@ftlauderdale.host" },
  { id: "fn-2", at: "2026-08-26T15:06:12.000Z", type: "checkout_started", planId: "pro", source: "checkout", email: "sofia@ftlauderdale.host" },
  { id: "fn-3", at: "2026-08-27T10:11:00.000Z", type: "upgrade_click", planId: "starter", source: "landing" },
  { id: "fn-4", at: "2026-08-27T18:22:00.000Z", type: "upgrade_click", planId: "agency", source: "settings", email: "andre@brickellops.com" },
  { id: "fn-5", at: "2026-08-28T09:01:00.000Z", type: "paid", planId: "starter", source: "webhook", email: "camila@miamibeachloft.com" },
  { id: "fn-6", at: "2026-08-28T12:40:00.000Z", type: "upgrade_click", planId: "pro", source: "landing" },
  { id: "fn-7", at: "2026-08-28T12:41:30.000Z", type: "checkout_started", planId: "pro", source: "checkout" },
];

const seedCharges: SquareCharge[] = [
  { id: "pay-1", at: "2026-08-28T14:18:00.000Z", amountUsd: 99, status: "SUCCESS", email: "javier@zencierge.app", planId: "pro", squarePaymentId: "sqpay_8F2K19" },
  { id: "pay-2", at: "2026-08-28T11:02:00.000Z", amountUsd: 49, status: "SUCCESS", email: "camila@miamibeachloft.com", planId: "starter", squarePaymentId: "sqpay_1A9P02" },
  { id: "pay-3", at: "2026-08-27T19:44:00.000Z", amountUsd: 99, status: "FAILED", email: "sofia@ftlauderdale.host", planId: "pro", squarePaymentId: "sqpay_4D2R88" },
  { id: "pay-4", at: "2026-08-26T08:15:00.000Z", amountUsd: 199, status: "SUCCESS", email: "andre@brickellops.com", planId: "agency", squarePaymentId: "sqpay_7Q3M44" },
  { id: "pay-5", at: "2026-08-12T13:44:00.000Z", amountUsd: 199, status: "SUCCESS", email: "nora@lasolasair.com", planId: "agency", squarePaymentId: "sqpay_2L8C01" },
];

const liveFunnel: FunnelEvent[] = [];
const liveCharges: SquareCharge[] = [];

export function recordFunnelEvent(input: Omit<FunnelEvent, "id" | "at"> & { at?: string }) {
  liveFunnel.unshift({
    id: randomUUID(),
    at: input.at ?? new Date().toISOString(),
    type: input.type,
    planId: input.planId,
    source: input.source,
    email: input.email,
  });
  if (liveFunnel.length > 400) liveFunnel.length = 400;
}

export function recordSquareCharge(input: Omit<SquareCharge, "id">) {
  liveCharges.unshift({ id: randomUUID(), ...input });
  if (liveCharges.length > 400) liveCharges.length = 400;
}

function startOfMonthIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function getAdminRevenueSnapshot() {
  const hosts = seedHosts;
  const funnel = [...liveFunnel, ...seedFunnel].sort((a, b) => b.at.localeCompare(a.at));
  const charges = [...liveCharges, ...seedCharges].sort((a, b) => b.at.localeCompare(a.at));
  const monthStart = startOfMonthIso();

  const active = hosts.filter((host) => host.status === "ACTIVE");
  const inactive = hosts.filter((host) => host.status === "TRIAL" || host.status === "CANCELED");
  const trials = hosts.filter((host) => host.status === "TRIAL");
  const mrr = active.reduce((sum, host) => sum + host.monthlyUsd, 0);

  const clicks = funnel.filter((event) => event.type === "upgrade_click");
  const paid = funnel.filter((event) => event.type === "paid");
  const conversionPct = clicks.length > 0 ? Math.round((paid.length / clicks.length) * 1000) / 10 : 0;

  const churnedThisMonth = hosts.filter(
    (host) => host.status === "CANCELED" && host.lastPaymentAt && host.lastPaymentAt >= monthStart,
  ).length;
  const failedThisMonth = charges.filter((charge) => charge.status === "FAILED" && charge.at >= monthStart).length;

  const planClicks = ZENCIERGE_PLAN_IDS.map((planId) => ({
    planId,
    name: ZENCIERGE_PLANS[planId].name,
    monthlyUsd: ZENCIERGE_PLANS[planId].monthlyUsd,
    clicks: clicks.filter((event) => event.planId === planId).length,
  }));

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      mrr,
      subscribedActive: active.length,
      subscribedInactive: inactive.length,
      trials: trials.length,
      hostTotal: hosts.length,
      upgradeClicks: clicks.length,
      paidSubscriptions: paid.length,
      conversionPct,
      churnThisMonth: churnedThisMonth,
      failedPaymentsThisMonth: failedThisMonth,
    },
    planClicks,
    hosts,
    funnel: funnel.slice(0, 40),
    charges: charges.slice(0, 25),
  };
}

export type AdminRevenueSnapshot = ReturnType<typeof getAdminRevenueSnapshot>;
