"use client";

import type { RefObject, ReactNode } from "react";
import { Activity, Phone, PhoneOff, Radio, Send, Sparkles, VolumeX } from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import type { ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import ElenaVoiceWidget from "@/components/dashboard/elena-voice-widget";

export type ReceptionistLine = {
  id: string;
  speaker: "guest" | "ai" | "system";
  text: string;
};

const QUICK_PROMPTS = [
  "¿Cuál es la clave del Wi-Fi?",
  "¿Hay una farmacia cerca?",
  "¿Dónde puedo comprar comida?",
  "Hay una fuga de agua en el baño",
];

export function AiReceptionistStudio({
  phase: _phase,
  voiceName: _voiceName,
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
  onStopSpeech,
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
    <section className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-950 p-5 sm:p-6 shadow-[0_0_80px_rgb(16_185_129_/_0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold">
            AI Receptionist
          </p>
          <h3 className="text-lg font-semibold text-white mt-1">Live avatar session</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            El cerebro es /api/avatar en español (propiedad en Miami / Miramar). HeyGen solo vocaliza con
            task_type repeat y voz femenina. Sin knowledge base ni conversación autónoma.
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
          <ElenaVoiceWidget />
          <p className="mt-3 text-[11px] text-slate-500 text-center">{connectionLabel}</p>
          <button
            type="button"
            onClick={onStopSpeech}
            disabled={!speaking}
            className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-slate-700 py-2 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            <VolumeX className="h-3.5 w-3.5" />
            Silenciar / detener voz
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold block mb-1.5">
              Active property
            </label>
            <select
              value={propertyId}
              onChange={(event) => onPropertyChange(event.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold block mb-1.5">
              Session language
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["auto", "Auto"],
                  ["es", "Español"],
                  ["en", "English"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onLanguageChange(value)}
                  className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${
                    language === value
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <p className="text-[11px] font-semibold text-slate-200">Handbook context</p>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed max-h-36 overflow-y-auto">
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
                <Phone className="h-4 w-4" /> Simulate inbound call
              </>
            )}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden flex flex-col min-h-[360px]">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Live transcript
            </p>
            <span className="text-[10px] text-slate-500">Guest · AI Receptionist</span>
          </div>
          <div ref={transcriptRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {lines.length === 0 && !callActive ? (
              <p className="text-xs text-slate-500 text-center pt-16 px-4">
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
            className="border-t border-slate-800 p-2 flex items-center gap-2"
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
              className="flex-1 bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
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
                className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] text-slate-400 hover:text-slate-200 hover:border-slate-700 disabled:opacity-40"
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
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-slate-700 bg-slate-900 text-slate-500"
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
      <p className="text-[10px] text-center text-slate-500 uppercase tracking-wide">{line.text}</p>
    );
  }

  const guest = line.speaker === "guest";
  return (
    <div className={`flex ${guest ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
          guest
            ? "bg-slate-800 text-slate-100 rounded-br-md"
            : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-50 rounded-bl-md"
        }`}
      >
        <p className="text-[10px] font-semibold mb-0.5 opacity-70">
          {guest ? "Guest" : "AI Receptionist"}
          {live ? (guest ? " · listening" : " · playing") : ""}
        </p>
        {line.text}
      </div>
    </div>
  );
}
