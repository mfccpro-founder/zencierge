import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin-auth";
import { requireHostUser } from "@/lib/supabase-route";

export async function AdminTabGuard({ children }: { children: ReactNode }) {
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
  return <>{children}</>;
}
