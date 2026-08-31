import type { ReactNode } from "react";

export function HostHeroBanner({
  title,
  subtitle,
  children,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  tone?: "default" | "shield";
}) {
  const banner =
    tone === "shield"
      ? "bg-gradient-to-r from-slate-800 via-blue-800 to-sky-800"
      : "bg-gradient-to-r from-slate-800 via-blue-900 to-indigo-900";
  return (
    <div className={`max-w-full overflow-hidden rounded-2xl px-5 py-4 shadow-sm ${banner}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-base text-slate-200">{subtitle}</p> : null}
        </div>
        {children ? <div className="flex flex-wrap items-center gap-3">{children}</div> : null}
      </div>
    </div>
  );
}
