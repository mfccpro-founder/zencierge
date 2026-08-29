import Link from "next/link";
import type { ReactNode } from "react";
import { ZenciergeLogo } from "@/components/brand/zencierge-logo";

export function AuthShell({
  title,
  subtitle,
  children,
  size = "compact",
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  size?: "compact" | "wide";
}) {
  const wide = size === "wide";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <div className={`w-full ${wide ? "mx-auto max-w-6xl" : "max-w-md"}`}>
        <Link href="/" className="mb-8 flex items-center gap-2">
          <ZenciergeLogo className="h-10 w-auto" />
        </Link>
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-[0_0_60px_rgb(16_185_129_/_0.08)] sm:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400">HOST ACCESS</p>
          <h1 className="mt-2 text-2xl font-bold text-white">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-600">Guest Portal at /guest remains publicly accessible.</p>
      </div>
    </div>
  );
}
