"use client";

import { useEffect, useState } from "react";
import type { Property } from "@/lib/dashboard-data";
import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";
import { ElenaIdleShell } from "@/components/guest/elena-idle-shell";
import { GuestSafeBoundary } from "@/components/guest/guest-safe-boundary";

/**
 * Isolates browser-only Elena logic. Server and the first client paint share
 * ElenaIdleShell so hydration matches; the live widget mounts after useEffect.
 */
export function ElenaGuestIsland({ property }: { property: Property }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div id="elena-ai" className="relative z-20 mt-8 w-full min-w-0 max-w-full overflow-x-hidden touch-manipulation" suppressHydrationWarning>
      {mounted ? (
        <GuestSafeBoundary>
          <ElenaVoiceWidget property={property} />
        </GuestSafeBoundary>
      ) : (
        <ElenaIdleShell />
      )}
    </div>
  );
}
