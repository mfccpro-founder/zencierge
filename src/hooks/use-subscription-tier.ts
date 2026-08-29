"use client";

import { useCallback, useEffect, useState } from "react";
import { ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

export type HostPayment = {
  id: string;
  amount_usd: number;
  plan_id: string | null;
  status: string;
  provider_payment_id: string | null;
  created_at: string;
};

export type SubscriptionTier = {
  planId: ZenciergePlanId;
  planName: string;
  monthlyUsd: number;
  status: string;
  isActive: boolean;
  maxProperties: number;
  propertyCount: number;
  canAddProperty: boolean;
  canUseOvernightCoverage: boolean;
  canUseAgencyTools: boolean;
  lastPaymentAt: string | null;
  currentPeriodEnd: string | null;
  tableReady: boolean;
  payments: HostPayment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const fallback: Omit<SubscriptionTier, "loading" | "error" | "refresh"> = {
  planId: "starter",
  planName: ZENCIERGE_PLANS.starter.name,
  monthlyUsd: ZENCIERGE_PLANS.starter.monthlyUsd,
  status: "inactive",
  isActive: false,
  maxProperties: 1,
  propertyCount: 0,
  canAddProperty: false,
  canUseOvernightCoverage: false,
  canUseAgencyTools: false,
  lastPaymentAt: null,
  currentPeriodEnd: null,
  tableReady: false,
  payments: [],
};

export function useSubscriptionTier(): SubscriptionTier {
  const [state, setState] = useState<Omit<SubscriptionTier, "refresh">>({
    ...fallback,
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/subscription");
      if (res.status === 401) {
        setState({ ...fallback, loading: false, error: null });
        return;
      }
      if (!res.ok) {
        throw new Error("Could not load subscription");
      }
      const data = (await res.json()) as Omit<SubscriptionTier, "loading" | "error" | "refresh">;
      setState({ ...fallback, ...data, loading: false, error: null });
    } catch (cause) {
      setState((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : "Could not load subscription",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
