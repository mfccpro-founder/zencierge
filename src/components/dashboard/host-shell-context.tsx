"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type HostShellContextValue = {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
};

const HostShellContext = createContext<HostShellContextValue | null>(null);

export function HostShellProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const value = useMemo(() => ({ mobileNavOpen, setMobileNavOpen }), [mobileNavOpen]);
  return <HostShellContext.Provider value={value}>{children}</HostShellContext.Provider>;
}

export function useHostShell() {
  const ctx = useContext(HostShellContext);
  if (!ctx) {
    return {
      mobileNavOpen: false,
      setMobileNavOpen: (_open: boolean) => undefined,
    };
  }
  return ctx;
}
