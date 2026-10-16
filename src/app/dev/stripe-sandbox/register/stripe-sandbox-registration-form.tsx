"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";

export function StripeSandboxRegistrationForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createAuthBrowserClient();
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      if (data.session) {
        router.push("/dev/stripe-sandbox");
        router.refresh();
        return;
      }
      setMessage("Cuenta creada. Confirma el correo y después entra desde /login.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo registrar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm text-slate-700">
        Correo de prueba
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="block text-sm text-slate-700">
        Contraseña
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button className="w-full rounded-lg bg-slate-950 px-4 py-2 font-semibold text-white disabled:opacity-60" disabled={busy} type="submit">
        {busy ? "Registrando…" : "Registrar cuenta de prueba"}
      </button>
      {message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}
    </form>
  );
}
