"use client";

import { useId } from "react";

export type ReceptionistPhase = "idle" | "listening" | "thinking" | "speaking";

const PHASE_COPY: Record<ReceptionistPhase, { label: string; hint: string }> = {
  idle: { label: "Idle", hint: "Waiting for a guest" },
  listening: { label: "Listening", hint: "Hearing the guest" },
  thinking: { label: "Thinking", hint: "Grounding in the handbook" },
  speaking: { label: "Speaking", hint: "Live audio out" },
};

const RING: Record<ReceptionistPhase, string> = {
  idle: "border-emerald-500/40 text-emerald-300",
  listening: "border-sky-400 text-sky-300",
  thinking: "border-amber-400 text-amber-300",
  speaking: "border-emerald-400 text-emerald-200",
};

const GLOW: Record<ReceptionistPhase, string> = {
  idle: "bg-emerald-400/15",
  listening: "bg-sky-400/35",
  thinking: "bg-amber-400/30",
  speaking: "bg-emerald-400/40",
};

export function ReceptionistAvatar({
  phase,
  size = "lg",
  name = "Elena",
}: {
  phase: ReceptionistPhase;
  size?: "sm" | "lg";
  name?: string;
}) {
  const large = size === "lg";
  const box = large ? "h-44 w-44" : "h-9 w-9";
  const face = large ? "h-32 w-32" : "h-7 w-7";
  const meta = PHASE_COPY[phase];
  const initial = (name.trim().charAt(0) || "E").toUpperCase();
  const faceGradId = useId().replace(/:/g, "");

  return (
    <div className={`relative flex flex-col items-center ${large ? "gap-4" : ""}`}>
      <div className={`relative ${box} flex items-center justify-center`}>
        {phase === "listening" ? (
          <>
            <span className="receptionist-listen-ring absolute inset-0 rounded-full border border-sky-400/50" />
            <span
              className="receptionist-listen-ring absolute inset-1 rounded-full border border-sky-300/30"
              style={{ animationDelay: "0.45s" }}
            />
          </>
        ) : null}
        {phase === "speaking" && large ? (
          <>
            <span className="receptionist-speak-ring absolute inset-0 rounded-full border border-emerald-400/40" />
            <span
              className="receptionist-speak-ring absolute inset-2 rounded-full border border-emerald-300/25"
              style={{ animationDelay: "0.35s" }}
            />
          </>
        ) : null}
        {phase === "thinking" ? (
          <span className="receptionist-think-ring absolute inset-0 rounded-full border-2 border-transparent border-t-amber-400 border-r-amber-400/30" />
        ) : null}
        <div
          className={`absolute inset-3 rounded-full blur-2xl receptionist-glow transition-colors duration-700 ${GLOW[phase]}`}
        />
        <div
          className={`relative ${face} rounded-full bg-gradient-to-br from-slate-700 via-slate-900 to-slate-950 border-2 ${RING[phase]} flex items-center justify-center shadow-[0_0_40px_rgb(16_185_129_/_0.18)] overflow-hidden transition-[border-color,box-shadow,color] duration-700 ${
            phase === "idle" ? "avatar-breathe" : phase === "speaking" ? "avatar-speak-pulse" : ""
          }`}
        >
          <ConciergeMark initial={initial} large={large} faceGradId={faceGradId} />
        </div>
      </div>
      {large ? (
        <>
          <div className="flex h-8 items-end justify-center gap-1">
            {Array.from({ length: 7 }, (_, index) => (
              <span
                key={index}
                className={`w-1 rounded-full transition-colors duration-500 ${
                  phase === "speaking"
                    ? "avatar-speak-bar bg-emerald-300"
                    : phase === "listening"
                      ? "h-3 bg-sky-400/70 animate-pulse"
                      : phase === "thinking"
                        ? "h-2 bg-amber-400/50"
                        : "h-1.5 bg-slate-600"
                }`}
                style={
                  phase === "speaking"
                    ? {
                        height: `${10 + ((index * 13) % 18)}px`,
                        animationDelay: `${index * 0.07}s`,
                      }
                    : undefined
                }
              />
            ))}
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{name}</p>
            <p
              className={`text-[11px] font-medium mt-0.5 transition-colors duration-500 ${
                phase === "speaking"
                  ? "text-emerald-300"
                  : phase === "listening"
                    ? "text-sky-300"
                    : phase === "thinking"
                      ? "text-amber-300"
                      : "text-slate-400"
              }`}
            >
              {meta.label}
              <span className="text-slate-500 font-normal"> · {meta.hint}</span>
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ConciergeMark({
  initial,
  large,
  faceGradId,
}: {
  initial: string;
  large: boolean;
  faceGradId: string;
}) {
  return (
    <svg
      viewBox="0 0 80 80"
      className={large ? "h-[78%] w-[78%]" : "h-[86%] w-[86%]"}
      aria-hidden
    >
      <defs>
        <radialGradient id={faceGradId} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <path
        d="M18 40c0-15 10-26 22-26s22 11 22 26"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.95"
      />
      <rect x="12" y="34" width="9" height="18" rx="4.5" fill="currentColor" />
      <rect x="59" y="34" width="9" height="18" rx="4.5" fill="currentColor" />
      <path
        d="M16 50c3 11 12 18 24 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.85"
      />
      <circle cx="42" cy="68" r="2.4" fill="currentColor" />
          <circle cx="40" cy="40" r="15.5" fill={`url(#${faceGradId})`} stroke="currentColor" strokeWidth="1.2" opacity="0.95" />
      <circle cx="34.5" cy="38" r="1.7" fill="#e2e8f0" />
      <circle cx="45.5" cy="38" r="1.7" fill="#e2e8f0" />
      <path
        d="M34 46c2.4 3.2 9.6 3.2 12 0"
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {large ? (
        <g>
          <circle cx="40" cy="22" r="6" fill="#0f172a" stroke="currentColor" strokeWidth="1.2" />
          <text
            x="40"
            y="25.5"
            textAnchor="middle"
            fill="currentColor"
            fontSize="8"
            fontWeight="700"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            {initial}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
