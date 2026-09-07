import type { Metadata } from "next";
import Link from "next/link";
import { BackOfficeComplimentaryPanel } from "@/components/admin/backoffice-complimentary-panel";
import { formatDate, getAdminBillingSnapshot } from "@/lib/admin-billing";
import {
  backOfficeCustomerStatusLabel,
  findBackOfficeCustomer,
  formatBackOfficePropertyCount,
  isTrialCustomer,
  loadPropertyCountsByHostId,
  propertyCountForHost,
} from "@/lib/backoffice-customers";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

export const metadata: Metadata = {
  title: "Customer detail · Zencierge Founder Back Office",
};

export const dynamic = "force-dynamic";

function CustomersBackLink() {
  return (
    <Link href="/backoffice/customers" className="text-sm font-semibold text-emerald-800 hover:underline">
      ← Customers
    </Link>
  );
}

export default async function BackOfficeCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [snapshot, propertyCounts] = await Promise.all([
    getAdminBillingSnapshot(),
    loadPropertyCountsByHostId(),
  ]);

  if (!snapshot.serviceRoleReady || snapshot.error) {
    return (
      <div className="space-y-6">
        <div>
          <CustomersBackLink />
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Customer detail</h1>
          <p className="mt-1 text-lg text-slate-700">Live customer data could not be loaded.</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error ??
            "SUPABASE_SERVICE_ROLE_KEY is not configured. The Back Office needs it to read live billing data."}
        </div>
        <p className="text-sm text-slate-600">
          Requested id: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{id}</code>
        </p>
      </div>
    );
  }

  const customer = findBackOfficeCustomer(snapshot.subscribers, id);
  if (!customer) {
    return (
      <div className="space-y-6">
        <div>
          <CustomersBackLink />
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Customer not found</h1>
          <p className="mt-1 text-lg text-slate-700">
            Customer not found in the current live billing snapshot
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
          <p>
            The route is valid, but this id is not present in{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">getAdminBillingSnapshot()</code> right
            now.
          </p>
          <p className="mt-2">
            Requested id: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{id}</code>
          </p>
          <p className="mt-2 text-slate-600">
            Snapshot has {snapshot.subscribers.length} customer
            {snapshot.subscribers.length === 1 ? "" : "s"} loaded.
          </p>
        </div>
      </div>
    );
  }

  const status = backOfficeCustomerStatusLabel(customer);
  const propertyCount = propertyCountForHost(propertyCounts, customer.userId);

  let ownedProperties: { id: string; name: string }[] = [];
  if (propertyCount > 0) {
    const admin = tryCreateSupabaseAdminClient();
    if (admin) {
      const { data } = await admin
        .from("properties")
        .select("id, name")
        .eq("host_id", customer.userId)
        .order("name");
      ownedProperties = (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? row.id),
      }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <CustomersBackLink />
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
          {customer.fullName ?? "Customer"}
        </h1>
        <p className="mt-1 text-lg text-slate-700">{customer.email}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Account</h2>
          <dl className="mt-3 space-y-2 text-sm text-slate-900">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">User id</dt>
              <dd className="font-mono text-xs">{customer.userId}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Phone</dt>
              <dd>{customer.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Status</dt>
              <dd className="font-semibold">{status}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Raw subscription status</dt>
              <dd>{customer.rawStatus}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Plan & billing</h2>
          <dl className="mt-3 space-y-2 text-sm text-slate-900">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Plan</dt>
              <dd>
                {customer.planName} · ${customer.monthlyUsd}/mo
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Last payment</dt>
              <dd>{formatDate(customer.lastPaymentAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">{isTrialCustomer(customer) ? "Period / trial end" : "Next billing"}</dt>
              <dd>{formatDate(customer.nextChargeAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Square customer</dt>
              <dd className="font-mono text-xs">{customer.squareCustomerId ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Square subscription</dt>
              <dd className="font-mono text-xs">{customer.squareSubscriptionId ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Properties</h2>
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {formatBackOfficePropertyCount(propertyCount)}
          </p>
          {ownedProperties.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {ownedProperties.map((property) => (
                <li key={property.id}>
                  {property.name}{" "}
                  <span className="font-mono text-xs text-slate-500">({property.id})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-slate-500">No properties linked via host_id.</p>
          )}
        </section>

        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Isabela usage</h2>
          <p className="mt-3 text-sm text-slate-700">Not instrumented</p>
          <p className="mt-1 text-xs text-slate-500">No fake costs or $0.00 estimates.</p>
        </section>
      </div>

      <BackOfficeComplimentaryPanel
        userId={customer.userId}
        email={customer.email}
        currentPlanId={customer.planId}
        complimentaryStartsAt={customer.complimentaryStartsAt}
        complimentaryEndsAt={customer.complimentaryEndsAt}
        squareSubscriptionId={customer.squareSubscriptionId}
        rawStatus={customer.rawStatus}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Payment alerts & failed charges
        </h2>
        {customer.alerts.length === 0 && customer.failedPayments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No recent alerts.</p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm text-slate-900">
            {customer.alerts.map((alert) => (
              <li key={`${customer.userId}-${alert.tag}`}>
                <span className="font-semibold text-rose-800">{alert.tag}</span>
                <span className="mt-0.5 block text-slate-700">{alert.message}</span>
              </li>
            ))}
            {customer.failedPayments.map((pay) => (
              <li key={pay.id} className="text-slate-700">
                Failed charge ${pay.amountUsd} · {formatDate(pay.at)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Complimentary writes are SuperAdmin-only and never create Square subscriptions.
      </p>
    </div>
  );
}
