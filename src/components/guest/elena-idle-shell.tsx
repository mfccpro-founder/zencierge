"use client";

import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import { Mic } from "lucide-react";

/** Deterministic markup for SSR + first client paint. Must match Elena idle UI. */
export function ElenaIdleShell() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-full space-y-4 overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-4 text-white shadow-xl sm:max-w-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ElenaAvatar size={52} />
          <div className="min-w-0 leading-tight">
            <h2 className="truncate text-base font-bold sm:text-lg">Elena · Receptionist</h2>
            <p className="text-[11px] text-slate-500">AI Voice Concierge</p>
          </div>
        </div>
        <span className="w-fit shrink-0 rounded-md border border-emerald-700 bg-emerald-900/60 px-2 py-1 text-xs text-emerald-400">
          Ready
        </span>
      </div>

      <button
        type="button"
        className="w-full rounded-xl py-3 text-sm font-bold transition bg-emerald-500 text-slate-950 hover:bg-emerald-400"
      >
        Tap to talk
      </button>

      <form className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(event) => event.preventDefault()}>
        <input
          id="elena-guest-input"
          type="text"
          placeholder="Type a message..."
          className="min-h-11 w-full min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          defaultValue=""
        />
        <div className="flex w-full gap-2 sm:w-auto">
        <button
          type="button"
          aria-label="Speak into the microphone"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-white transition hover:bg-slate-600"
        >
          <Mic className="h-5 w-5" />
        </button>
        <button
          type="submit"
          className="min-h-11 flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold transition hover:bg-blue-500 sm:flex-none"
        >
          Send
        </button>
        </div>
      </form>

      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">Standby · No media session</p>
        <button
          type="button"
          className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 tabular text-xs font-semibold text-slate-300 hover:bg-slate-900 hover:text-white transition"
        >
          Mute / Stop voice
        </button>
      </div>
    </div>
  );
}
