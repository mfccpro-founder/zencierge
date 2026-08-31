"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Isolates Elena / WebKit crashes so the rest of the guest stay page stays usable. */
export class GuestSafeBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[guest] Elena widget crashed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="w-full min-w-0 max-w-full space-y-4 overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-4 text-white shadow-xl sm:p-5">
          <p className="text-lg font-bold">Elena · Receptionist</p>
          <p className="text-sm text-slate-400">Voice is unavailable in this browser. Type below.</p>
          <form
            className="flex min-w-0 flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <input
              type="text"
              placeholder="Type a message..."
              className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-600 rounded-lg text-white text-sm"
            />
            <button type="submit" className="px-4 py-2 bg-blue-600 rounded-lg text-sm font-semibold">
              Send
            </button>
          </form>
        </div>
      );
    }
    return this.props.children;
  }
}
