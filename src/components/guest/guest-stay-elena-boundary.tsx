"use client";

import { Component, type ReactNode } from "react";

export const GUEST_STAY_ELENA_BOUNDARY_COPY = {
  en: "Isabela is temporarily unavailable. You can still use the services below.",
  es: "Isabela no está disponible temporalmente. Todavía puedes usar los servicios de abajo.",
} as const;

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Isolates Elena render/lifecycle failures from stay details, services, and 911. */
export class GuestStayElenaBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mt-6 rounded-2xl border border-cyan-400/25 bg-[#0d3258]/85 p-4">
          <p className="text-sm leading-relaxed text-slate-200">{GUEST_STAY_ELENA_BOUNDARY_COPY.en}</p>
          <p className="mt-2 text-sm leading-relaxed text-cyan-200/80">{GUEST_STAY_ELENA_BOUNDARY_COPY.es}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
