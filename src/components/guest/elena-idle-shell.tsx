"use client";

import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import { Mic } from "lucide-react";

/** Deterministic markup for SSR + first client paint. Must match Elena idle UI. */
export function ElenaIdleShell() {
  return (
    <div className="p-5 bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm mx-auto text-white shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3.5 min-w-0">
          <ElenaAvatar size={64} />
          <div className="leading-tight min-w-0">
            <h2 className="text-lg font-bold truncate">Elena · Receptionist</h2>
            <p className="text-[11px] text-slate-500">AI Voice Concierge</p>
          </div>
        </div>
        <span className="shrink-0 text-xs px-2 py-1 bg-emerald-900/60 text-emerald-400 border border-emerald-700 rounded-md">
          Ready
        </span>
      </div>

      <button
        type="button"
        className="w-full rounded-xl py-3 text-sm font-bold transition bg-emerald-500 text-slate-950 hover:bg-emerald-400"
      >
        Tap to talk
      </button>

      <form className="flex flex-row items-center gap-2 w-full" onSubmit={(event) => event.preventDefault()}>
        <input
          id="elena-guest-input"
          type="text"
          placeholder="Type a message..."
          className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          defaultValue=""
        />
        <button
          type="button"
          aria-label="Speak into the microphone"
          className="shrink-0 flex items-center justify-center w-11 h-[40px] rounded-lg transition bg-slate-700 hover:bg-slate-600 text-white"
        >
          <Mic className="h-5 w-5" />
        </button>
        <button
          type="submit"
          className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 font-semibold rounded-lg transition text-sm"
        >
          Send
        </button>
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
