"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createAuthBrowserClient();
    void supabase.auth
      .getUser()
      .then(({ data }: { data: { user: User | null } }) => setReady(Boolean(data.user)));
    const { data } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => setReady(Boolean(session?.user)),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) { setError("Use at least 12 characters with uppercase, lowercase, and a number."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true); setError(null);
    try { const supabase = createAuthBrowserClient(); const { error: cause } = await supabase.auth.updateUser({ password }); if (cause) throw cause; await supabase.auth.signOut(); setPassword(""); setConfirm(""); setDone(true); }
    catch { setError("The recovery link is invalid or expired. Request a new link."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-6 py-12"><section className="w-full space-y-5 rounded-2xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-xl"><h1 className="text-2xl font-bold">Choose a new password</h1>{done ? <div className="space-y-4"><p className="text-sm text-emerald-300">Password updated. You can now sign in.</p><Link href="/login" className="block rounded-xl bg-emerald-500 py-2.5 text-center text-sm font-bold text-slate-950">Return to sign in</Link></div> : !ready ? <div className="space-y-3"><p className="text-sm text-slate-300">Validating the recovery link…</p><Link href="/auth/recover" className="text-xs text-emerald-400">Request a new link</Link></div> : <form className="space-y-4" onSubmit={submit}><label className="block text-xs text-slate-400">New password<input required type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white" /></label><label className="block text-xs text-slate-400">Confirm password<input required type="password" minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white" /></label>{error ? <p className="text-xs text-rose-400">{error}</p> : null}<button disabled={busy} className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60">{busy ? "Updating…" : "Update password"}</button></form>}</section></main>;
}
