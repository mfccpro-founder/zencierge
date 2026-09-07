"use client";

import { useEffect, useState } from "react";
import { GuestStayAccessCard } from "@/components/guest/guest-stay-access-card";
import { GuestStayElenaBoundary } from "@/components/guest/guest-stay-elena-boundary";
import { GuestElenaTextCard } from "@/components/guest/guest-elena-text-card";
import { GuestStayServices } from "@/components/guest/guest-stay-services";
import { GUEST_STAY_SHELL_COPY } from "@/lib/guest-stay-qr";
import { publicApiUrl } from "@/lib/public-app-url";

export type GuestStayShellState =
  | "loading"
  | "active"
  | "invalid"
  | "expired"
  | "revoked"
  | "unavailable";

type SafeStay = {
  propertyName: string;
  city: string;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  status: "active";
};

export const GUEST_STAY_GENERIC_HEADING = "Guest portal";

const PUBLIC_STAY_STRING_FIELDS = [
  "propertyName",
  "city",
  "checkIn",
  "checkInTime",
  "checkOut",
  "checkOutTime",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function guestStayDisplayHeading(propertyName: string): string {
  return propertyName.trim() === "" ? GUEST_STAY_GENERIC_HEADING : propertyName;
}

export function guestStayShowsConciergeExtras(
  state: GuestStayShellState,
  stay: SafeStay | null,
): boolean {
  return state === "active" && stay !== null;
}

export function interpretGuestStayShellPayload(
  httpOk: boolean,
  payload: unknown,
): { state: Exclude<GuestStayShellState, "loading">; stay: SafeStay | null } {
  if (!isPlainObject(payload)) {
    return { state: "invalid", stay: null };
  }

  if ("error" in payload && payload.error !== undefined) {
    if (payload.error === "expired") {
      return { state: "expired", stay: null };
    }
    if (payload.error === "revoked") {
      return { state: "revoked", stay: null };
    }
    if (payload.error === "unavailable") {
      return { state: "unavailable", stay: null };
    }
    return { state: "invalid", stay: null };
  }

  if (!httpOk) {
    return { state: "invalid", stay: null };
  }

  if (payload.status !== "active") {
    return { state: "invalid", stay: null };
  }

  for (const field of PUBLIC_STAY_STRING_FIELDS) {
    if (!isString(payload[field])) {
      return { state: "invalid", stay: null };
    }
  }

  return {
    state: "active",
    stay: {
      propertyName: payload.propertyName as string,
      city: payload.city as string,
      checkIn: payload.checkIn as string,
      checkInTime: payload.checkInTime as string,
      checkOut: payload.checkOut as string,
      checkOutTime: payload.checkOutTime as string,
      status: "active",
    },
  };
}

export function GuestStayShell({ token }: { token: string }) {
  const [state, setState] = useState<GuestStayShellState>("loading");
  const [stay, setStay] = useState<SafeStay | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(publicApiUrl("/api/guest/stay"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ token }),
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (!cancelled) setState("invalid");
          return;
        }
        if (cancelled) return;
        const next = interpretGuestStayShellPayload(response.ok, payload);
        setStay(next.stay);
        setState(next.state);
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const en = GUEST_STAY_SHELL_COPY.en;
  const es = GUEST_STAY_SHELL_COPY.es;
  const message =
    state === "loading"
      ? { en: en.loading, es: es.loading }
      : state === "expired"
        ? { en: en.expired, es: es.expired }
        : state === "revoked"
          ? { en: en.revoked, es: es.revoked }
          : state === "unavailable"
            ? { en: en.unavailable, es: es.unavailable }
            : state === "invalid"
              ? { en: en.invalid, es: es.invalid }
              : null;

  return (
    <div className="relative z-10 min-h-dvh w-full min-w-0 overflow-x-hidden bg-gradient-to-b from-[#071833] via-[#0b2a4a] to-[#082238] text-slate-100 touch-manipulation">
      <div className="mx-auto w-full min-w-0 max-w-md px-4 pb-24 pt-8 sm:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300/90">Zencierge · Guest</p>
        {state === "active" && stay ? (
          <>
            <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {guestStayDisplayHeading(stay.propertyName)}
            </h1>
            <p className="mt-2 text-sm text-slate-300">{stay.city}</p>
            <div className="mt-6 space-y-3">
              <div className="rounded-2xl border border-cyan-400/25 bg-[#0d3258]/85 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{en.checkIn} / {es.checkIn}</p>
                <p className="mt-1 text-base font-semibold text-white">
                  {stay.checkIn}
                  {stay.checkInTime ? ` · ${stay.checkInTime}` : ""}
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-400/25 bg-[#0d3258]/85 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{en.checkOut} / {es.checkOut}</p>
                <p className="mt-1 text-base font-semibold text-white">
                  {stay.checkOut}
                  {stay.checkOutTime ? ` · ${stay.checkOutTime}` : ""}
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-400/35 bg-cyan-500/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">{en.status} / {es.status}</p>
                <p className="mt-1 text-base font-semibold text-cyan-50">{en.active} · {es.active}</p>
              </div>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-slate-300">{en.activeHint}</p>
            <p className="mt-2 text-sm leading-relaxed text-cyan-200/80">{es.activeHint}</p>
            <p className="mt-4 text-xs text-slate-300">{en.expires}</p>
            <p className="text-xs text-cyan-200/75">{es.expires}</p>
            {guestStayShowsConciergeExtras(state, stay) ? (
              <>
                <GuestStayAccessCard key={token} token={token} />
                <GuestStayElenaBoundary>
                  <GuestElenaTextCard token={token} />
                </GuestStayElenaBoundary>
                <GuestStayServices />
              </>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{GUEST_STAY_GENERIC_HEADING}</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">{message?.en}</p>
            <p className="mt-2 text-sm leading-relaxed text-cyan-200/80">{message?.es}</p>
          </>
        )}
        <a
          href="tel:911"
          className="mt-8 block min-h-11 rounded-2xl border-2 border-rose-400 bg-gradient-to-b from-rose-600 to-rose-800 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-950/40"
        >
          {en.emergency}
          <span className="mt-1 block text-xs font-normal text-rose-100">{es.emergency}</span>
        </a>
      </div>
    </div>
  );
}
