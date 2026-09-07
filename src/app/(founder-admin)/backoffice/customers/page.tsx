import type { Metadata } from "next";
import { getAdminBillingSnapshot } from "@/lib/admin-billing";
import { loadPropertyCountsByHostId } from "@/lib/backoffice-customers";
import { BackOfficeCustomersTable } from "@/components/admin/backoffice-customers-table";

export const metadata: Metadata = {
  title: "Customers · Zencierge Founder Back Office",
  description: "Live host/customer roster from billing subscriptions.",
};

export const dynamic = "force-dynamic";

export default async function BackOfficeCustomersPage() {
  const [snapshot, propertyCounts] = await Promise.all([
    getAdminBillingSnapshot(),
    loadPropertyCountsByHostId(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Customers</h1>
        <p className="mt-1 text-lg text-slate-700">
          Live host accounts from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">getAdminBillingSnapshot()</code>
          . Property counts from <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">properties.host_id</code>
          . Read-only.
        </p>
      </div>

      {!snapshot.serviceRoleReady || snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error ??
            "SUPABASE_SERVICE_ROLE_KEY is not configured. The Back Office needs it to read all subscriptions."}
        </div>
      ) : null}

      <BackOfficeCustomersTable customers={snapshot.subscribers} propertyCounts={propertyCounts} />

      <p className="text-sm text-slate-600">
        Property counts use live <code>properties.host_id</code> ownership only — never fabricated. Isabela usage
        is not instrumented — no fake costs are shown.
      </p>
    </div>
  );
}
