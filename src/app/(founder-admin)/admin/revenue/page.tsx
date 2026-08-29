import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isSuperAdmin } from "@/lib/admin-auth";
import { requireHostUser } from "@/lib/supabase-route";
import { AdminRevenueDashboard } from "@/components/admin/admin-revenue-dashboard";

export const metadata: Metadata = {
  title: "Admin · Revenue | Zencierge",
  description: "Platform MRR, Square subscriptions, and conversion funnel.",
};

export default async function AdminRevenuePage() {
  const auth = await requireHostUser();
  if (!auth.user) {
    redirect("/login?next=/admin/revenue");
  }
  if (!isSuperAdmin(auth.user)) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        Superadmin only. Add your email to ADMIN_EMAILS or set user metadata role to superadmin.
      </div>
    );
  }
  return <AdminRevenueDashboard />;
}
