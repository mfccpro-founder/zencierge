import type { ReactNode } from "react";
import { InteractiveConciergeTour } from "@/components/InteractiveConciergeTour";

export function HostOpsPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl min-w-0 space-y-4 overflow-x-hidden px-6 py-10 lg:px-10">
      <InteractiveConciergeTour />
      {children}
    </div>
  );
}
