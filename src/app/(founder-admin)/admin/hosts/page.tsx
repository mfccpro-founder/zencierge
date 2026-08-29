import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isSuperAdmin } from "@/lib/admin-auth";
import { requireHostUser } from "@/lib/supabase-route";
import { getAdminBillingSnapshot, type PaymentState } from "@/lib/admin-billing";
import { AdminHostsTable } from "@/components/admin/admin-hosts-table";

export const metadata: Metadata = {
  title: "Hosts & Subscriptions · Zencierge Admin",
  description: "Subscriber roster, payment status, billing dates, and Square alerts.",
};

export const dynamic = "force-dynamic";

const VALID_FILTERS = new Set(["all", "al_dia", "moroso", "cancelado", "sin_suscripcion"]);

export default async function AdminHostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const auth = await requireHostUser();
  if (!auth.user) {
    redirect("/login?next=/admin/hosts");
  }
  if (!isSuperAdmin(auth.user)) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        This Back Office is restricted to superadmins. Add your email to ADMIN_EMAILS in .env.local or set role=superadmin in
        your user metadata.
      </div>
    );
  }

  const params = await searchParams;
  const statusParam = params.status ?? "all";
  const initialFilter = (VALID_FILTERS.has(statusParam) ? statusParam : "all") as "all" | PaymentState;

  const snapshot = await getAdminBillingSnapshot();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Hosts &amp; Subscriptions</h1>
        <p className="mt-1 text-lg text-slate-700">
          Search, filter, and page through every host without scrolling a single giant table.
        </p>
      </div>

      {!snapshot.serviceRoleReady || snapshot.error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
          {snapshot.error ?? "SUPABASE_SERVICE_ROLE_KEY is not configured. The Back Office needs it to read all subscriptions."}
        </div>
      ) : null}

      <AdminHostsTable subscribers={snapshot.subscribers} initialFilter={initialFilter} />

      <p className="text-sm text-slate-700">
        Square does not expose card expiration dates through webhooks. “Possible expired card” alerts are derived from recent
        failed charges and overdue billing dates. Past-due hosts and rows with alerts are listed first.
      </p>
    </div>
  );
}
