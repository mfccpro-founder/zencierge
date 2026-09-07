import type { Metadata } from "next";
import { BackOfficeBillingPanel } from "@/components/admin/backoffice-billing-panel";
import {
  getAdminBillingSnapshot,
  summarizeAdminBillingByPlan,
} from "@/lib/admin-billing";

export const metadata: Metadata = {
  title: "Billing · Zencierge Founder Back Office",
  description: "Read-only subscription status, plan MRR, and payment signals from live billing data.",
};

export const dynamic = "force-dynamic";

export default async function BackOfficeBillingPage() {
  const snapshot = await getAdminBillingSnapshot();
  const plans = summarizeAdminBillingByPlan(snapshot.subscribers);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Billing</h1>
        <p className="mt-1 text-lg text-slate-700">
          Live subscription operations from <code>host_subscriptions</code> and <code>subscription_payments</code>.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Read-only · plan rates come from the Zencierge catalog · no Square actions or demo revenue.
        </p>
      </div>

      {!snapshot.serviceRoleReady || snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error ??
            "SUPABASE_SERVICE_ROLE_KEY is not configured. The Back Office needs it to read live billing data."}
        </div>
      ) : null}

      <BackOfficeBillingPanel
        customers={snapshot.subscribers}
        metrics={snapshot.metrics}
        plans={plans}
        generatedAt={snapshot.generatedAt}
      />
    </div>
  );
}
