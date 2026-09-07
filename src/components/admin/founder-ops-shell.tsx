"use client";

import { useEffect, type ReactNode } from "react";

const PAGE_CLASS = "founder-ops-page";
const THEME_COLOR = "#EAF6FF";

/**
 * Owns the full iOS Safari viewport paint for Founder Back Office.
 * Does not rely on :has() — stamps an explicit class on html/body and
 * mounts a fixed full-screen sky backdrop behind content.
 */
export function FounderOpsShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add(PAGE_CLASS);
    body.classList.add(PAGE_CLASS);

    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    const previous = meta.getAttribute("content");
    meta.setAttribute("content", THEME_COLOR);

    return () => {
      html.classList.remove(PAGE_CLASS);
      body.classList.remove(PAGE_CLASS);
      if (created) {
        meta?.remove();
      } else if (previous != null) {
        meta?.setAttribute("content", previous);
      } else {
        meta?.removeAttribute("content");
      }
    };
  }, []);

  return (
    <div className="founder-ops" style={{ colorScheme: "light" }}>
      <div className="founder-ops-viewport-bg" aria-hidden="true" />
      {children}
    </div>
  );
}
