"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Lightbulb } from "lucide-react";
import {
  HOST_NAV_SECTIONS,
  SETTINGS_PATH,
  hostNavSectionIdForPath,
  isHostNavItemActive,
} from "@/lib/host-nav";
import { useFeatureRequest } from "@/components/dashboard/feature-request-widget";
import { useHostShell } from "@/components/dashboard/host-shell-context";

function HostSidebarInner() {
  const pathname = usePathname() || "/dashboard";
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const { open: openFeatureRequest } = useFeatureRequest();
  const { mobileNavOpen, setMobileNavOpen } = useHostShell();
  const activeSectionId = hostNavSectionIdForPath(pathname, tab);
  const [openIds, setOpenIds] = useState<string[]>([activeSectionId]);

  useEffect(() => {
    setOpenIds((current) => (current.includes(activeSectionId) ? current : [...current, activeSectionId]));
  }, [activeSectionId]);

  const toggleSection = (id: string) => {
    setOpenIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <>
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <aside
        className={`z-40 h-screen w-64 shrink-0 flex-col border-r border-indigo-950/40 bg-slate-800 md:sticky md:top-0 ${
          mobileNavOpen ? "fixed inset-y-0 left-0 flex" : "hidden md:flex"
        }`}
      >
        <div className="shrink-0 border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-lg font-bold text-white">
              Z
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">Zencierge</h1>
              <p className="text-xs text-slate-200">Host OS · Florida</p>
            </div>
          </div>
        </div>

        <nav
          aria-label="Main"
          className="host-sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        >
          <div className="space-y-1">
            {HOST_NAV_SECTIONS.map((section) => {
              const standaloneItem = section.standalone ? section.items[0] : undefined;
              if (standaloneItem) {
                const settingsActive = isHostNavItemActive(pathname, tab, standaloneItem);
                return (
                  <div key={section.id} className="mt-2 border-t border-white/10 pt-2">
                    <Link
                      href={SETTINGS_PATH}
                      aria-current={settingsActive ? "page" : undefined}
                      onClick={() => setMobileNavOpen(false)}
                      className="host-nav-item flex w-full items-center rounded-lg px-3 py-1.5 text-sm font-medium"
                      data-current={settingsActive ? "true" : "false"}
                    >
                      {section.label}
                    </Link>
                  </div>
                );
              }

              const expanded = openIds.includes(section.id);
              const sectionActive = section.id === activeSectionId;
              return (
                <div key={section.id} className="rounded-xl">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={expanded}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider transition-colors ${
                      sectionActive
                        ? "bg-white/10 text-white"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}
                  >
                    <span className="min-w-0 leading-snug">{section.label}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                  {expanded ? (
                    <div className="mt-0.5 space-y-0.5 pb-1 pl-1">
                      {section.items.map((item) => {
                        const active = isHostNavItemActive(pathname, tab, item);
                        const tour =
                          item.href.startsWith("/dashboard/voice-agent") && !item.tab ? "voice" : undefined;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            data-tour={tour}
                            aria-current={active ? "page" : undefined}
                            data-current={active ? "true" : "false"}
                            className={`host-nav-item flex w-full items-center rounded-lg py-1.5 text-sm font-medium ${
                              item.nested ? "px-3 pl-5" : "px-3"
                            }`}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                      {section.id === "legal" ? (
                        <button
                          type="button"
                          onClick={openFeatureRequest}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-white/10 hover:text-white"
                        >
                          <Lightbulb className="h-3.5 w-3.5" />
                          Request a Feature
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="flex items-center justify-between rounded-xl border border-white/15 bg-white/10 p-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-xs font-medium text-slate-200">Elena line</span>
            </div>
            <span className="rounded-md bg-white px-2 py-0.5 font-mono text-[10px] font-medium text-slate-900">
              +1 (305) 555-0199
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

export function HostSidebar() {
  return (
    <Suspense fallback={<aside className="hidden h-screen w-64 shrink-0 bg-slate-800 md:flex" />}>
      <HostSidebarInner />
    </Suspense>
  );
}
