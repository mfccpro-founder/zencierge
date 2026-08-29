import type { ReactNode } from "react";
import { HostOpsNav } from "@/components/dashboard/host-ops-nav";
import { FeatureRequestProvider } from "@/components/dashboard/feature-request-widget";
import { ZenciergeLogo } from "@/components/brand/zencierge-logo";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureRequestProvider>
      <div className="scheme-light min-h-screen bg-slate-50 text-slate-900" style={{ colorScheme: "light" }}>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3" data-tour="host-os">
              <ZenciergeLogo className="h-10 w-auto brightness-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Zencierge Host OS</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Properties, Elena, and on-property operations
                </p>
              </div>
            </div>
            <HostOpsNav />
          </div>
        </header>
        {children}
      </div>
    </FeatureRequestProvider>
  );
}
