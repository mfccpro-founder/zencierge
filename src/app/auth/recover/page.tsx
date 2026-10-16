"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";

export default function RecoverPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const redirectTo = `${window.location.origin}/auth/update-password`;
      const { error: cause } = await createAuthBrowserClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (cause) throw cause;
      setSent(true);
    } catch { setError("Could not send the recovery link. Verify the address and try again."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-6 py-12"><section className="w-full space-y-5 rounded-2xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-xl"><div><h1 className="text-2xl font-bold">Reset your password</h1><p className="mt-2 text-sm text-slate-400">We will email a single-use recovery link. Zencierge never sees your new password.</p></div>{sent ? <p className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">Check your email and open the recovery link on this device.</p> : <form className="space-y-4" onSubmit={submit}><label className="block text-xs text-slate-400">Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white" /></label>{error ? <p className="text-xs text-rose-400">{error}</p> : null}<button disabled={busy} className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60">{busy ? "Sending…" : "Send recovery link"}</button></form>}<Link href="/login" className="block text-center text-xs text-emerald-400">Back to sign in</Link></section></main>;
}
