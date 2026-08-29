"use client";

import { useEffect, useState } from "react";
import type { Property } from "@/lib/dashboard-data";
import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";
import { ElenaIdleShell } from "@/components/guest/elena-idle-shell";

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
    <div id="elena-ai" className="mt-8 relative z-20 touch-manipulation" suppressHydrationWarning>
      {mounted ? <ElenaVoiceWidget property={property} /> : <ElenaIdleShell />}
    </div>
  );
}
