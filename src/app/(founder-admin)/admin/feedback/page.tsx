import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin-auth";
import { requireHostUser } from "@/lib/supabase-route";
import { AdminFeedbackInbox } from "@/components/admin/admin-feedback-inbox";

export const metadata: Metadata = {
  title: "Feature Requests · Zencierge Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage() {
  const auth = await requireHostUser();
  if (!auth.user) {
    redirect("/login?next=/admin/feedback");
  }
  if (!isSuperAdmin(auth.user)) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        This Back Office is restricted to superadmins. Add your email to ADMIN_EMAILS in .env.local or set role=superadmin in
        your user metadata.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Feature Requests</h1>
        <p className="mt-1 text-lg text-slate-700">
          Incoming host suggestions from the Host OS. Filter by category or status, then move each item through the product
          roadmap.
        </p>
      </div>
      <AdminFeedbackInbox />
    </div>
  );
}
