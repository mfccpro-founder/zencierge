"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BookOpen, Lightbulb, List, Search, Volume2 } from "lucide-react";
import {
  HOST_GUIDE_UI,
  buildHostGuideModules,
  getHostGuideLangServerSnapshot,
  getHostGuideLangSnapshot,
  hostGuideSearchableText,
  setHostGuideLang,
  subscribeHostGuideLang,
} from "@/lib/host-guide-content";
import { dispatchHostTourCommand } from "@/lib/host-guide-tour";

export function HostUserGuide() {
  const lang = useSyncExternalStore(
    subscribeHostGuideLang,
    getHostGuideLangSnapshot,
    getHostGuideLangServerSnapshot,
  );
  const [query, setQuery] = useState("");
  const ui = HOST_GUIDE_UI[lang];
  const modules = useMemo(() => buildHostGuideModules(lang), [lang]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return modules;
    return modules.filter((mod) => hostGuideSearchableText(mod).toLowerCase().includes(needle));
  }, [modules, query]);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 mb-2 border-b border-slate-200 bg-slate-50/95 pb-4 pt-2 backdrop-blur-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-700">{ui.langLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => dispatchHostTourCommand({ type: "start" })}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-sky-700"
            >
              {ui.startTour}
            </button>
            <button
              type="button"
              onClick={() => dispatchHostTourCommand({ type: "explain" })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-800 hover:bg-slate-100"
            >
              {ui.explainPage}
            </button>
            <div className="flex rounded-xl border border-slate-300 bg-white p-0.5" role="group" aria-label={ui.langLabel}>
              {(["en", "es"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setHostGuideLang(code)}
                  aria-pressed={lang === code}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                    lang === code ? "bg-sky-600 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {code === "en" ? ui.english : ui.spanish}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ui.searchPlaceholder}
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-900">
            <List className="h-3.5 w-3.5" /> {ui.toc}
          </p>
          <ol className="mt-3 space-y-1">
            {modules.map((mod, index) => {
              const hidden = query.trim() !== "" && !visible.some((row) => row.id === mod.id);
              return (
                <li key={mod.id}>
                  <a
                    href={`#${mod.id}`}
                    className={`block rounded-lg px-2 py-1.5 text-sm font-semibold ${
                      hidden ? "text-slate-400" : "text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    {index + 1}. {mod.title}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="space-y-5">
          {visible.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-900">
              {ui.emptySearch}
            </p>
          ) : (
            visible.map((mod) => (
              <article
                key={mod.id}
                id={mod.id}
                className="scroll-mt-28 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{mod.title}</h2>
                    <p className="mt-1 text-sm font-medium text-slate-800">{mod.summary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => dispatchHostTourCommand({ type: "listen", moduleId: mod.id })}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100"
                    >
                      <Volume2 className="h-3.5 w-3.5" /> {ui.listen}
                    </button>
                    <Link
                      href={mod.href}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700"
                    >
                      <BookOpen className="h-3.5 w-3.5" /> {ui.openModule}
                    </Link>
                  </div>
                </div>
                <div className="grid gap-5 p-5 lg:grid-cols-2">
                  <section>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">{ui.lifecycle}</h3>
                    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm font-medium text-slate-900">
                      {mod.lifecycle.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </section>
                  <section>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">{ui.steps}</h3>
                    <ol className="mt-3 space-y-3">
                      {mod.steps.map((step, index) => (
                        <li key={`${mod.id}-${index}-${step.title}`}>
                          <p className="text-sm font-bold text-slate-900">
                            {index + 1}. {step.title}
                          </p>
                          <p className="mt-1 text-sm text-slate-800">{step.body}</p>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
                <div className="border-t border-slate-200 bg-amber-50 px-5 py-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Lightbulb className="h-4 w-4" /> {ui.tips}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-medium text-slate-900">
                    {mod.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
