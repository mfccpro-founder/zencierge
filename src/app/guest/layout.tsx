import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh w-full min-w-0 overflow-x-hidden bg-gradient-to-b from-[#071833] via-[#0b2a4a] to-[#082238] pointer-events-auto touch-manipulation" suppressHydrationWarning>
      {children}
    </div>
  );
}
