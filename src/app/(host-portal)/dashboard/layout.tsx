import type { ReactNode } from "react";
import { DashboardTabScroll } from "@/components/dashboard/dashboard-tab-scroll";
import { FeatureRequestProvider } from "@/components/dashboard/feature-request-widget";
import { ListingsProvider } from "@/components/dashboard/listings-provider";
import { HostShellProvider } from "@/components/dashboard/host-shell-context";
import { HostSidebar } from "@/components/dashboard/host-sidebar";
import { HostShellHeader } from "@/components/dashboard/host-shell-header";
import { InteractiveConciergeTour } from "@/components/InteractiveConciergeTour";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureRequestProvider>
      <ListingsProvider>
        <HostShellProvider>
          <div className="scheme-light flex min-h-screen bg-slate-50 text-slate-900" style={{ colorScheme: "light" }}>
            <HostSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <HostShellHeader />
              <DashboardTabScroll />
              <div className="min-w-0 flex-1 overflow-x-hidden p-6 lg:p-8">
                <InteractiveConciergeTour />
                {children}
              </div>
            </div>
          </div>
        </HostShellProvider>
      </ListingsProvider>
    </FeatureRequestProvider>
  );
}
