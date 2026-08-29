"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";
import { describeAuthFailure, supabaseEnvIssue } from "@/lib/supabase-config";
import { allowDevHostSession, shouldFallbackToDevHost } from "@/lib/dev-host-session";
import { PlanFeatureList } from "@/components/pricing/pricing-cards";
import { savePendingSignup } from "@/lib/pending-signup";
import {
  buildTrialMetadata,
  isPaidSubscriptionStatus,
  isTrialWindowOpen,
  parsePlanId,
  ZENCIERGE_PLAN_IDS,
  ZENCIERGE_PLANS,
  type ZenciergePlanId,
} from "@/lib/zencierge-plans";

export function HostAuthForm({
  mode,
  nextPath = "/dashboard",
  initialPlan = "pro",
}: {
  mode: "login" | "signup";
  nextPath?: string;
  initialPlan?: ZenciergePlanId;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [planId, setPlanId] = useState<ZenciergePlanId>(parsePlanId(initialPlan) ?? "pro");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";
  const selectedPlan = ZENCIERGE_PLANS[planId];
  const destination =
    (nextPath.startsWith("/dashboard") || nextPath.startsWith("/admin")) && !nextPath.startsWith("//")
      ? nextPath
      : "/dashboard";

  const handleSignupAndCheckout = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const buyerEmail = email.trim();
      const buyerName = fullName.trim();
      if (!buyerName || !buyerEmail.includes("@")) {
        throw new Error("Enter your name and email to start checkout.");
      }
      savePendingSignup({ fullName: buyerName, email: buyerEmail, planId });
      try {
        await fetch("/api/auth/dev-session", { method: "DELETE" });
      } catch {
        /* ignore leftover local-preview cookie */
      }
      try {
        const supabase = createAuthBrowserClient();
        await supabase.auth.signOut();
      } catch {
        /* no live GoTrue session to clear */
      }
      await fetch("/api/auth/pending-host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: buyerName, email: buyerEmail, planId }),
      }).catch((cause) => {
        console.error("Pending host session failed; continuing to Square checkout", cause);
      });

      const response = await fetch("/api/checkout/square", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          billing: "monthly",
          email: buyerEmail,
          name: buyerName,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
      };
      const checkoutUrl = typeof data.checkoutUrl === "string" ? data.checkoutUrl.trim() : "";
      if (!checkoutUrl) {
        console.error("[signup] Square checkoutUrl missing; staying on /signup (no dashboard redirect)", {
          status: response.status,
          data,
        });
        setError(data.error ?? "Square did not return a checkoutUrl. Check the browser console.");
        return;
      }
      if (!/^https?:\/\//i.test(checkoutUrl) || /\/dashboard(?:\/|\?|$)/i.test(checkoutUrl)) {
        console.error("[signup] Refusing non-Square or dashboard checkoutUrl; staying on /signup", checkoutUrl);
        setError("Square checkoutUrl was invalid. Check the browser console.");
        return;
      }
      window.location.href = checkoutUrl;
    } catch (cause) {
      console.error("[signup] Square checkout failed; not redirecting to /dashboard", cause);
      setError(cause instanceof Error ? cause.message : "Could not start Square checkout");
    } finally {
      setBusy(false);
    }
  };

  const enterLocalPreview = async () => {
    const response = await fetch("/api/auth/dev-session", { method: "POST" });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Could not start local host preview.");
    }
    window.location.assign(destination);
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (supabaseEnvIssue() && allowDevHostSession()) {
        await enterLocalPreview();
        return;
      }

      const supabase = createAuthBrowserClient();
      const { data, error: cause } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (cause) throw cause;
      if (!data.session?.user) throw new Error("Could not start a host session. Please try again.");
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      const paid = isPaidSubscriptionStatus(String(meta.subscription_status ?? ""));
      if (!paid && !isTrialWindowOpen(meta.trial_ends_at) && !meta.trial_ends_at) {
        await supabase.auth.updateUser({
          data: buildTrialMetadata(parsePlanId(meta.plan) ?? planId, {
            full_name: meta.full_name,
            first_name: meta.first_name,
          }),
        });
      }
      router.replace(destination);
      router.refresh();
    } catch (cause) {
      if (shouldFallbackToDevHost(cause) || shouldFallbackToDevHost(describeAuthFailure(cause))) {
        try {
          setNotice("Supabase rejected the API key. Opening a local host preview…");
          await enterLocalPreview();
          return;
        } catch (fallback) {
          setError(describeAuthFailure(fallback));
          return;
        }
      }
      setError(describeAuthFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const onSignupFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.form?.requestSubmit();
  };

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50";

  const localPreviewButton =
    allowDevHostSession() && !isSignup ? (
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          void enterLocalPreview().catch((cause) => {
            setBusy(false);
            setError(describeAuthFailure(cause));
          });
        }}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-sm font-semibold text-slate-200 hover:border-emerald-500/40 hover:text-white disabled:opacity-60"
      >
        Enter Host Dashboard (local preview)
      </button>
    ) : null;

  const accountFields = (
    <>
      {isSignup ? (
        <label className="block text-xs text-slate-400">
          Full name
          <input
            type="text"
            required
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            onKeyDown={isSignup ? onSignupFieldKeyDown : undefined}
            placeholder="Your name"
            className={fieldClass}
          />
        </label>
      ) : null}
      <label className="block text-xs text-slate-400">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={isSignup ? onSignupFieldKeyDown : undefined}
          placeholder="host@example.com"
          className={fieldClass}
        />
      </label>
      <label className="block text-xs text-slate-400">
        Password
        <input
          type="password"
          required
          minLength={6}
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={isSignup ? onSignupFieldKeyDown : undefined}
          placeholder="At least 6 characters"
          className={fieldClass}
        />
      </label>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-300">{notice}</p> : null}
      <button
        type="submit"
        form={isSignup ? "signup-checkout-form" : undefined}
        disabled={busy}
        className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {busy ? "Please wait…" : isSignup ? "Subscribe / Start Plan" : "Sign In to Dashboard"}
      </button>
      {localPreviewButton}
      <p className="text-center text-xs text-slate-500">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New host?{" "}
            <Link href={`/signup?plan=${planId}`} className="text-emerald-400 hover:text-emerald-300">
              Create an account
            </Link>
          </>
        )}
      </p>
    </>
  );

  if (isSignup) {
    return (
      <form
        id="signup-checkout-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSignupAndCheckout(event);
        }}
        className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start"
      >
        <aside className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Chosen plan</p>
          <h2 className="mt-2 text-lg font-bold leading-snug text-white">
            {selectedPlan.name} Plan — ${selectedPlan.monthlyUsd}/mo
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            14-day trial terms apply after you complete Square Sandbox checkout.
          </p>
          <label className="mt-5 block text-xs font-semibold text-slate-400">
            Change plan
            <select
              className={fieldClass}
              value={planId}
              onChange={(event) => {
                const next = parsePlanId(event.target.value) ?? planId;
                setPlanId(next);
                router.replace(`/signup?plan=${next}`, { scroll: false });
              }}
            >
              {ZENCIERGE_PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {ZENCIERGE_PLANS[id].name} — ${ZENCIERGE_PLANS[id].monthlyUsd}/mo
                </option>
              ))}
            </select>
          </label>
          <div className="mt-5 border-t border-slate-800 pt-4">
            <PlanFeatureList planId={planId} tone="dark" />
          </div>
        </aside>
        <div className="min-w-0 space-y-4">{accountFields}</div>
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void handleLogin(event)} className="space-y-4">
      {accountFields}
    </form>
  );
}
