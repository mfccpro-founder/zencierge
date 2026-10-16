"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Lightbulb } from "lucide-react";
import {
  HOST_NAV_SECTIONS,
  hostNavSectionIdForPath,
  isHostNavItemActive,
} from "@/lib/host-nav";
import { getHostTourHighlight, subscribeHostTourHighlight } from "@/lib/host-guide-tour";
import { useFeatureRequest } from "@/components/dashboard/feature-request-widget";
import { useHostShell } from "@/components/dashboard/host-shell-context";

function HostSidebarInner() {
  const pathname = usePathname() || "/dashboard";
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const { open: openFeatureRequest } = useFeatureRequest();
  const { mobileNavOpen, setMobileNavOpen } = useHostShell();
  const activeSectionId = hostNavSectionIdForPath(pathname, tab);
  const tourNavId = useSyncExternalStore(subscribeHostTourHighlight, getHostTourHighlight, () => "");
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
        className={`z-40 h-screen w-[min(18rem,calc(100vw-2rem))] shrink-0 flex-col border-r border-slate-700 bg-slate-900 shadow-2xl md:sticky md:top-0 md:w-72 md:shadow-none ${
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
          className="host-sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
        >
          <div className="space-y-1">
            {HOST_NAV_SECTIONS.map((section) => {
              const standaloneItem = section.standalone ? section.items[0] : undefined;
              if (standaloneItem) {
                const itemActive = isHostNavItemActive(pathname, tab, standaloneItem);
                return (
                  <div key={section.id} className="mt-2 border-t border-white/15 pt-2">
                    <Link
                      href={standaloneItem.href}
                      data-nav-id={standaloneItem.id}
                      aria-current={itemActive ? "page" : undefined}
                      onClick={() => setMobileNavOpen(false)}
                      className={`host-nav-item flex min-h-11 w-full items-center rounded-lg border-l-[3px] border-l-transparent px-3 py-2 text-sm font-semibold transition-colors ${
                        tourNavId === standaloneItem.id ? "ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-800" : ""
                      }`}
                      data-current={itemActive ? "true" : "false"}
                    >
                      {section.label}
                    </Link>
                  </div>
                );
              }

              const expanded = openIds.includes(section.id);
              const sectionActive = section.id === activeSectionId;
              return (
                <div key={section.id} className="rounded-xl py-0.5">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={expanded}
                    className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.09em] text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                      sectionActive
                        ? "bg-white/10"
                        : "bg-transparent"
                    }`}
                  >
                    <span className="min-w-0 leading-snug">{section.label}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                  {expanded ? (
                    <div className="mt-1 space-y-1 pb-1">
                      {section.items.map((item) => {
                        const active = isHostNavItemActive(pathname, tab, item);
                        const tour =
                          item.href.startsWith("/dashboard/voice-agent") && !item.tab ? "voice" : undefined;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            data-nav-id={item.id}
                            data-tour={tour}
                            aria-current={active ? "page" : undefined}
                            data-current={active ? "true" : "false"}
                            className={`host-nav-item flex min-h-10 w-full items-center rounded-lg border-l-[3px] border-l-transparent py-2 text-sm font-semibold transition-colors ${
                              item.nested ? "px-3 pl-6" : "px-3"
                            } ${tourNavId === item.id ? "ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-800" : ""}`}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                      {section.id === "legal" ? (
                        <button
                          type="button"
                          onClick={openFeatureRequest}
                          className="flex min-h-10 w-full items-center gap-2 rounded-lg border-l-[3px] border-l-transparent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
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
