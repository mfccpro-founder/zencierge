"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";

export function HostAuthForm({
  mode,
  nextPath = "/dashboard",
}: {
  mode: "login" | "signup";
  nextPath?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";
  const destination =
    nextPath.startsWith("/dashboard") && !nextPath.startsWith("//") ? nextPath : "/dashboard";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const supabase = createAuthBrowserClient();
    try {
      if (isSignup) {
        const { data, error: cause } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: {
              full_name: fullName.trim() || "Javier",
              first_name: (fullName.trim() || "Javier").split(/\s+/)[0],
            },
          },
        });
        if (cause) throw cause;
        if (data.session) {
          router.replace(destination);
          router.refresh();
          return;
        }
        setNotice("Revisa tu correo para confirmar la cuenta. Luego inicia sesión.");
        return;
      }

      const { data, error: cause } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (cause) throw cause;
      if (!data.session) throw new Error("No se pudo crear la sesión.");
      router.replace(destination);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar el acceso.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {isSignup ? (
        <label className="block text-xs text-slate-400">
          Nombre
          <input
            type="text"
            autoComplete="given-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Javier"
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
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
          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
        />
      </label>
      <label className="block text-xs text-slate-400">
        Contraseña
        <input
          type="password"
          required
          minLength={6}
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
        />
      </label>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-300">{notice}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {busy ? "Un momento…" : isSignup ? "Crear cuenta de anfitrión" : "Entrar al dashboard"}
      </button>
      <p className="text-center text-xs text-slate-500">
        {isSignup ? (
          <>
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
              Iniciar sesión
            </Link>
          </>
        ) : (
          <>
            ¿Eres nuevo?{" "}
            <Link href="/signup" className="text-emerald-400 hover:text-emerald-300">
              Crear cuenta
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
