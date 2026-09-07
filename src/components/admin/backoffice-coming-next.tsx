export function BackOfficeComingNext(input: { title: string; detail: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{input.title}</h1>
        <p className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
          Coming next · not yet implemented
        </p>
      </div>
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-700 shadow-sm">
        {input.detail}
      </div>
    </div>
  );
}
