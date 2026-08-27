"use client";

import { useEffect } from "react";

function isInjectedFlagsNoise(reason: unknown) {
  const text =
    reason instanceof Error
      ? `${reason.name} ${reason.message}`
      : typeof reason === "string"
        ? reason
        : String(reason ?? "");
  return /flags error response|amplitude|@amplitude|experiment|rokt/i.test(text);
}

/** Cursor / Rokt / Amplitude Experiment inject scripts that 401 and freeze React if unhandled. */
export function IgnoreThirdPartyAnalytics() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isInjectedFlagsNoise(event.reason)) return;
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}
