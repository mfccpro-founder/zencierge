import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh w-full min-w-0 overflow-x-hidden bg-[#07080c] pointer-events-auto touch-manipulation" suppressHydrationWarning>
      {children}
    </div>
  );
}
