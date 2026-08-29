import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, CreditCard, TriangleAlert, Users } from "lucide-react";
import { isSuperAdmin } from "@/lib/admin-auth";
import { requireHostUser } from "@/lib/supabase-route";
import { getAdminBillingSnapshot, formatDate } from "@/lib/admin-billing";

export const metadata: Metadata = {
  title: "Overview · Zencierge Admin",
  description: "Platform KPIs for subscribed hosts, MRR, and past-due accounts.",
};

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const auth = await requireHostUser();
  if (!auth.user) {
    redirect("/login?next=/admin");
  }
  if (!isSuperAdmin(auth.user)) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        This Back Office is restricted to superadmins. Add your email to ADMIN_EMAILS in .env.local or set role=superadmin in
        your user metadata.
      </div>
    );
  }

  const snapshot = await getAdminBillingSnapshot();
  const { metrics } = snapshot;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Overview</h1>
          <p className="mt-1 text-lg text-slate-700">
            Platform snapshot · {formatDate(snapshot.generatedAt)}{" "}
            {new Date(snapshot.generatedAt).toLocaleTimeString("en-US")}
          </p>
        </div>
        <Link
          href="/admin/hosts"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
        >
          View All Hosts <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {!snapshot.serviceRoleReady || snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error ?? "SUPABASE_SERVICE_ROLE_KEY is not configured. The Back Office needs it to read all subscriptions."}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Total Active Hosts</p>
            <Users className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.alDia}</p>
          <p className="mt-2 text-sm text-slate-700">In good standing (paid / current)</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Total MRR</p>
            <CreditCard className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">${metrics.mrr.toLocaleString("en-US")}</p>
          <p className="mt-2 text-sm text-slate-700">From active host subscriptions</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between text-slate-700">
            <p className="text-sm font-semibold uppercase tracking-wide">Past Due Count</p>
            <TriangleAlert className="h-5 w-5" />
          </div>
          <p className="mt-3 text-4xl font-extrabold text-slate-900">{metrics.morosos}</p>
          <p className="mt-2 text-sm text-slate-700">{metrics.failedPayments30d} failed charges in 30 days</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Quick Actions</p>
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/admin/hosts"
              className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-900 hover:bg-slate-100"
            >
              View All Hosts
            </Link>
            <Link
              href="/admin/hosts?status=moroso"
              className="rounded-xl border border-rose-800 bg-rose-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-800"
            >
              Open past-due roster
            </Link>
            <Link
              href="/admin/revenue"
              className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
            >
              Revenue &amp; Square fees
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
