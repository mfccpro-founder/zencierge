"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { FEATURE_CATEGORIES } from "@/lib/host-feature-requests";

const FeatureRequestContext = createContext<{ open: () => void } | null>(null);

export function useFeatureRequest() {
  const ctx = useContext(FeatureRequestContext);
  if (!ctx) throw new Error("Feature request UI must be used inside FeatureRequestProvider.");
  return ctx;
}

export function FeatureRequestProvider({ children }: { children: ReactNode }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<(typeof FEATURE_CATEGORIES)[number]["id"]>(FEATURE_CATEGORIES[0].id);
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const reset = () => {
    setTitle("");
    setCategory(FEATURE_CATEGORIES[0].id);
    setDescription("");
    setError(null);
  };

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/host/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, description }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Could not submit your request.");
      reset();
      setOpen(false);
      setToast("Thank you! Your suggestion has been submitted directly to our product roadmap.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit your request.");
    } finally {
      setSending(false);
    }
  };

  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  const field =
    "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-500 focus:border-indigo-600 focus:outline-none";

  return (
    <FeatureRequestContext.Provider value={value}>
      {children}

      {toast ? (
        <div className="fixed bottom-24 right-6 z-[60] max-w-sm rounded-xl border border-emerald-800 bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-xl font-bold text-slate-900">
                  Request a New Feature
                </h2>
                <p className="mt-1 text-sm text-slate-700">
                  Help us shape the future of Zencierge. Tell us what tools or improvements you need.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-900" htmlFor="feature-title">
                  Feature Title
                </label>
                <input
                  id="feature-title"
                  className={`${field} mt-2`}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g., WhatsApp automated guest notifications"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-900" htmlFor="feature-category">
                  Category
                </label>
                <select
                  id="feature-category"
                  className={`${field} mt-2`}
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as (typeof FEATURE_CATEGORIES)[number]["id"])
                  }
                >
                  {FEATURE_CATEGORIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-900" htmlFor="feature-description">
                  Description
                </label>
                <textarea
                  id="feature-description"
                  rows={5}
                  className={`${field} mt-2`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Explain how this feature would help your hosting operations..."
                />
              </div>
              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </FeatureRequestContext.Provider>
  );
}
