import { LEGACY_GUEST_LINK_COPY } from "@/lib/guest-stay-qr";

export function LegacyGuestLink() {
  return (
    <div className="relative z-10 min-h-dvh w-full min-w-0 overflow-x-hidden bg-[#07080c] text-slate-100 touch-manipulation">
      <div className="mx-auto w-full min-w-0 max-w-md px-4 pb-24 pt-10 sm:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/80">Zencierge · Guest</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Guest portal</h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-300">{LEGACY_GUEST_LINK_COPY.en}</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">{LEGACY_GUEST_LINK_COPY.es}</p>
      </div>
    </div>
  );
}
