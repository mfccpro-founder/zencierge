"use client";

import type { RefObject, ReactNode } from "react";
import { Activity, Phone, PhoneOff, Radio, Send, Sparkles } from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import type { ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";

const PHASE_LABEL: Record<ReceptionistPhase, string> = {
  idle: "Ready — press Test Call with Elena",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Elena is speaking…",
};

export type ReceptionistLine = {
  id: string;
  speaker: "guest" | "ai" | "system";
  text: string;
};

const QUICK_PROMPTS = [
  "What is the Wi-Fi password?",
  "Is there a nearby pharmacy?",
  "Where can I buy food / groceries?",
  "There is a water leak in the bathroom",
];

export function AiReceptionistStudio({
  phase,
  voiceName,
  properties,
  selectedProperty,
  propertyId,
  onPropertyChange,
  language,
  onLanguageChange,
  callActive,
  latencyMs,
  streamReady,
  connectionLabel,
  lines,
  partialAi,
  partialGuest,
  draft,
  onDraftChange,
  onSimulateCall,
  onEndCall,
  onSend,
  onListen: _onListen,
  onStopSpeech: _onStopSpeech,
  listening: _listening,
  speaking,
  transcriptRef,
  videoRef: _videoRef,
  videoReady: _videoReady,
}: {
  phase: ReceptionistPhase;
  voiceName: string;
  properties: Property[];
  selectedProperty: Property;
  propertyId: string;
  onPropertyChange: (id: string) => void;
  language: "auto" | "en" | "es";
  onLanguageChange: (value: "auto" | "en" | "es") => void;
  callActive: boolean;
  latencyMs: number | null;
  streamReady: boolean;
  connectionLabel: string;
  lines: ReceptionistLine[];
  partialAi: string;
  partialGuest: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSimulateCall: () => void;
  onEndCall: () => void;
  onSend: (text: string) => void;
  onListen: () => void;
  onStopSpeech: () => void;
  listening: boolean;
  speaking: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  videoRef?: RefObject<HTMLVideoElement | null>;
  videoReady?: boolean;
}) {
  const handbook = selectedProperty.handbook.trim();

  return (
    <section className="rounded-3xl border border-cyan-700 bg-gradient-to-br from-cyan-700 via-teal-700 to-sky-800 p-5 text-cyan-950 shadow-sm sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/90">
            AI Receptionist
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">Live avatar session</h3>
          <p className="mt-1 max-w-xl text-xs text-cyan-50">
            The backend is /api/avatar in English/Spanish (Miami / Miramar property). Elena speaks
            with a female voice in the live session.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            ok={streamReady}
            label={streamReady ? "Audio stream ready" : "WebRTC idle"}
            icon={<Radio className="h-3 w-3" />}
          />
          <StatusChip
            ok={latencyMs !== null}
            label={latencyMs !== null ? `${latencyMs} ms think` : "Latency —"}
            icon={<Activity className="h-3 w-3" />}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_minmax(0,1.1fr)] gap-6">
        <div className="flex flex-col items-center justify-start">
          {/* Prominent Elena avatar with live voice-wave animation */}
          <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-white/50 bg-white/85 p-4">
            <div
              className={`rounded-full transition-all duration-300 ${
                phase === "speaking"
                  ? "ring-4 ring-emerald-400/50 scale-105"
                  : phase === "listening"
                    ? "ring-2 ring-sky-400/40"
                    : ""
              }`}
            >
              <ElenaAvatar size={96} />
            </div>
            <p className="text-xs font-semibold text-slate-900">
              {phase === "speaking"
                ? "Elena is speaking…"
                : phase === "listening"
                  ? "Listening…"
                  : phase === "thinking"
                    ? "Thinking…"
                    : "Elena · Ready"}
            </p>
            <div className="flex items-end justify-center gap-1 h-6">
              {[0, 1, 2, 3, 4].map((bar) => (
                <span
                  key={bar}
                  className={`w-1.5 rounded-full bg-emerald-400 transition-all ${
                    phase === "speaking"
                      ? "animate-pulse"
                      : phase === "listening"
                        ? "animate-pulse opacity-50"
                        : "opacity-20"
                  }`}
                  style={{
                    height: phase === "speaking" || phase === "listening" ? undefined : "6px",
                    animationDelay: `${bar * 120}ms`,
                    ...(phase === "speaking" || phase === "listening"
                      ? { height: `${8 + ((bar * 5) % 13)}px` }
                      : {}),
                  }}
                />
              ))}
            </div>
          </div>
          <ElenaVoiceWidget property={selectedProperty} />
          <p className="mt-3 text-center text-[11px] text-cyan-50">{connectionLabel}</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/80">
              Active property
            </label>
            <select
              value={propertyId}
              onChange={(event) => onPropertyChange(event.target.value)}
              className="w-full rounded-xl border border-white/60 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-white"
            >
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/80">
              Session language
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["auto", "Auto"],
                  ["es", "Spanish"],
                  ["en", "English"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onLanguageChange(value)}
                  className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${
                    language === value
                      ? "border-white bg-white text-cyan-900"
                      : "border-white/50 bg-white/70 text-cyan-950 hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/50 bg-white/85 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-cyan-700" />
              <p className="text-[11px] font-semibold text-cyan-950">Handbook context</p>
            </div>
            <p className="max-h-36 overflow-y-auto text-[11px] leading-relaxed text-slate-700">
              {handbook || "No ai_handbook yet for this unit. Add one in Properties."}
            </p>
          </div>

          <button
            type="button"
            onClick={callActive ? onEndCall : onSimulateCall}
            className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-all ${
              callActive
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                : "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
            }`}
          >
            {callActive ? (
              <>
                <PhoneOff className="h-4 w-4" /> End voice session
              </>
            ) : (
              <>
                <Phone className="h-4 w-4" /> Test Call with Elena
              </>
            )}
          </button>
        </div>

        <div className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
          <div className="flex items-center justify-between border-b border-sky-200 bg-sky-100 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-900">
              Live transcript
            </p>
            <span className="text-[10px] font-medium text-sky-800">Guest · AI Receptionist</span>
          </div>
          <div ref={transcriptRef} className="flex-1 space-y-2 overflow-y-auto bg-sky-50 p-3">
            {lines.length === 0 && !callActive ? (
              <p className="px-4 pt-16 text-center text-xs font-medium text-sky-900">
                Start a session to watch bilingual turn-taking in real time.
              </p>
            ) : null}
            {lines.map((line) => (
              <TranscriptBubble key={line.id} line={line} />
            ))}
            {partialGuest ? (
              <TranscriptBubble
                line={{ id: "partial-guest", speaker: "guest", text: partialGuest }}
                live
              />
            ) : null}
            {partialAi ? (
              <TranscriptBubble line={{ id: "partial", speaker: "ai", text: partialAi }} live />
            ) : null}
          </div>
          {speaking ? (
            <div className="flex items-end justify-center gap-1 h-8 pb-1">
              {Array.from({ length: 9 }, (_, index) => (
                <span
                  key={index}
                  className="voice-bar w-1 rounded-full bg-emerald-400/80"
                  style={{ animationDelay: `${index * 0.07}s` }}
                />
              ))}
            </div>
          ) : null}
          <form
            className="flex items-center gap-2 border-t border-sky-200 bg-sky-50 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSend(draft);
            }}
          >
            <input
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              disabled={speaking}
              placeholder="Guest message (ES / EN)…"
              className="flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={speaking || !draft.trim()}
              className="shrink-0 rounded-xl p-2 bg-emerald-500 text-slate-950 disabled:opacity-40"
              aria-label="Send question"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
          <div className="flex flex-wrap gap-1.5 px-2 pb-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={speaking}
                onClick={() => onSend(prompt)}
                className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[10px] text-sky-900 hover:border-sky-300 hover:bg-sky-100 disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusChip({ ok, label, icon }: { ok: boolean; label: string; icon: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
        ok
          ? "border-white/70 bg-white text-cyan-800"
          : "border-white/40 bg-white/50 text-white"
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

function TranscriptBubble({ line, live = false }: { line: ReceptionistLine; live?: boolean }) {
  if (line.speaker === "system") {
    return (
      <p className="text-center text-[10px] font-medium uppercase tracking-wide text-sky-800">{line.text}</p>
    );
  }

  const guest = line.speaker === "guest";
  return (
    <div className={`flex ${guest ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3 py-2 text-xs font-medium leading-relaxed ${
          guest
            ? "rounded-br-md bg-sky-800 text-white"
            : "rounded-bl-md border border-sky-200 bg-white text-sky-950"
        }`}
      >
        <p className={`mb-0.5 text-[10px] font-bold ${guest ? "text-sky-100" : "text-sky-700"}`}>
          {guest ? "Guest" : "AI Receptionist"}
          {live ? (guest ? " · listening" : " · playing") : ""}
        </p>
        {line.text}
      </div>
    </div>
  );
}
