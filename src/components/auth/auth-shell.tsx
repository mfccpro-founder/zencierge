import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-2 mb-8">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/20 text-sm font-bold text-emerald-400">
            Z
          </span>
          <span className="text-sm font-semibold">Zencierge</span>
        </Link>
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-[0_0_60px_rgb(16_185_129_/_0.08)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
            Host access
          </p>
          <h1 className="mt-2 text-2xl font-bold text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-600">
          El Portal del Huésped en /guest sigue siendo público.
        </p>
      </div>
    </div>
  );
}
