import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/admin-nav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="scheme-light min-h-screen bg-slate-50 text-slate-900" style={{ colorScheme: "light" }}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-700 shadow-sm">
              Z
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Zencierge Admin</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-700">Platform owner metrics · superadmin</p>
            </div>
          </div>
          <AdminNav />
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">{children}</div>
    </div>
  );
}
