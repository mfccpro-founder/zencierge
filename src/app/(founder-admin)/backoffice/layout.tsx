import type { ReactNode } from "react";
import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { BackOfficeNav } from "@/components/admin/backoffice-nav";
import { FounderOpsShell } from "@/components/admin/founder-ops-shell";
import { isSuperAdmin } from "@/lib/admin-auth";
import { requireHostUser } from "@/lib/supabase-route";

export const viewport: Viewport = {
  themeColor: "#EAF6FF",
  colorScheme: "light",
};

export default async function BackOfficeLayout({ children }: { children: ReactNode }) {
  const auth = await requireHostUser();
  if (!auth.user) {
    redirect("/login?next=/backoffice");
  }
  if (!isSuperAdmin(auth.user)) {
    redirect("/dashboard");
  }

  return (
    <FounderOpsShell>
      <header className="founder-ops-header border-b">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="founder-ops-mark flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold shadow-sm">
              Z
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight text-slate-900">
                Zencierge Founder Back Office
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#2F80ED]">
                Platform owner · operations · superadmin only
              </p>
            </div>
          </div>
          <BackOfficeNav />
        </div>
      </header>
      <div className="relative z-[1] mx-auto max-w-7xl px-6 py-10 lg:px-10">{children}</div>
    </FounderOpsShell>
  );
}
