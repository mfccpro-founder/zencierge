import type { ReactNode } from "react";

export function HostOpsPage({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-6">{children}</div>;
}
