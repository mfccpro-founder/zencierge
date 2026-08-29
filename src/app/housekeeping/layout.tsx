import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Housekeeping photo upload · Zencierge",
  robots: { index: false, follow: false },
};

export default function HousekeepingLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-slate-100 text-slate-900">{children}</div>;
}
