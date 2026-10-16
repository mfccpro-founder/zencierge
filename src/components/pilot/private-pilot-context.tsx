"use client";

import { createContext, useContext, type ReactNode } from "react";

const PrivatePilotContext = createContext(false);

export function PrivatePilotProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <PrivatePilotContext.Provider value={enabled}>{children}</PrivatePilotContext.Provider>;
}

export function usePrivatePilotMode() {
  return useContext(PrivatePilotContext);
}
