import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function GuestLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-[#07080c]">{children}</div>;
}
