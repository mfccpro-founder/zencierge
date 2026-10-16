"use client";

import { useCallback, useEffect, useState } from "react";
import type { GuestServiceRequest, GuestServiceRequestStatus } from "@/lib/guest-service-requests";

const PATH = "/api/housekeeping/service-requests";
const LABELS: Record<GuestServiceRequestStatus, string> = {
  requested: "Requested", assigned: "Assigned", in_progress: "In progress",
  evidence_submitted: "Photos submitted", completed: "Completed", needs_attention: "Needs attention",
};

export function GuestServiceRequestsCard() {
  const [requests, setRequests] = useState<GuestServiceRequest[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(PATH, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as { requests?: GuestServiceRequest[] };
      if (!response.ok || !Array.isArray(payload.requests)) throw new Error("unavailable");
      setRequests(payload.requests);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function move(request: GuestServiceRequest, status: GuestServiceRequestStatus) {
    setBusy(request.id);
    try {
      const response = await fetch(PATH, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ id: request.id, status }),
      });
      if (!response.ok) throw new Error("unavailable");
      await load();
    } catch { setState("error"); } finally { setBusy(""); }
  }

  return (
    <section className="rounded-3xl border border-sky-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-sky-700">Guest requests</p><h2 className="mt-1 text-xl font-bold text-slate-950">Saturday demo queue</h2></div>
        <button className="rounded-full border px-3 py-1.5 text-xs font-semibold" onClick={() => void load()}>Refresh</button>
      </div>
      {state === "loading" ? <p className="mt-4 text-sm text-slate-500">Loading requests…</p> : null}
      {state === "error" ? <p className="mt-4 text-sm font-semibold text-rose-700">Requests unavailable. No demo data substituted.</p> : null}
      {state === "ready" && requests.length === 0 ? <p className="mt-4 text-sm text-slate-500">No guest requests recorded.</p> : null}
      <div className="mt-4 space-y-3">
        {requests.map((request) => (
          <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-bold text-slate-950">Two extra towels</p><p className="text-xs text-slate-500">Stay {request.reservationId} · Property {request.propertyId}</p></div>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">{LABELS[request.status]}</span>
            </div>
            <p className="mt-2 text-sm text-slate-700">Assigned to: {request.assignedTo ?? "Not assigned"}</p>
            <p className="text-xs text-slate-500">Maid acceptance: {request.acceptedAt ? "Recorded" : "Not registered"}</p>
            <p className="text-xs text-slate-500">Photo proof: {request.proofTaskId ? "Linked" : "Not registered"}</p>
            <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">Report: {request.reportNote ?? "No registrado"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {request.status === "requested" ? <button disabled={busy === request.id} onClick={() => void move(request, "assigned")} className="rounded-xl bg-sky-700 px-3 py-2 text-xs font-bold text-white">Assign to Demo Housekeeping</button> : null}
              {(request.status === "assigned" || request.status === "needs_attention") ? <button disabled={busy === request.id} onClick={() => void move(request, "in_progress")} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">Start work</button> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
