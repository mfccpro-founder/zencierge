"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Megaphone } from "lucide-react";
import { COMMUNITY_ALERT_TYPES, type CommunityAlertType } from "@/lib/admin-neighbor-shield";

type AlertRow = {
  id: string;
  property_id: string | null;
  alert_type: string;
  message: string;
  is_test: boolean;
  created_at: string;
  guest_notified?: boolean;
};

const TYPE_STYLE: Record<string, string> = {
  noise: "border-amber-800 bg-amber-600 text-white",
  parking: "border-sky-800 bg-sky-700 text-white",
  trash: "border-emerald-900 bg-emerald-800 text-white",
  test: "border-slate-800 bg-slate-700 text-white",
};

const TYPE_LABEL: Record<string, string> = {
  noise: "Noise",
  parking: "Parking",
  trash: "Trash",
  test: "Test",
};

export function NeighborShieldPanel() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [propertyId, setPropertyId] = useState("prop-1");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/neighbor-shield");
      const data = (await res.json()) as { alerts?: AlertRow[]; error?: string };
      setAlerts(data.alerts ?? []);
      if (data.error) setFeedback({ ok: false, text: data.error });
    } catch {
      setFeedback({ ok: false, text: "Failed to load alerts." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const postAlert = async (alertType: string, notifyGuest: boolean, extraMessage?: string) => {
    setSending(`${alertType}:${notifyGuest ? "guest" : "log"}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/neighbor-shield", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          alertType,
          notifyGuest,
          message: extraMessage ?? note,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        guestNoticeQueued?: boolean;
        guestNotice?: string;
        guestPhone?: string | null;
        alert?: AlertRow;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? "Alert failed.");
      if (data.alert) {
        setAlerts((prev) => [data.alert!, ...prev.filter((row) => row.id !== data.alert!.id)]);
      }
      const notice = data.guestNoticeQueued
        ? ` Guest notice queued${data.guestPhone ? ` for ${data.guestPhone}` : ""}.`
        : "";
      setFeedback({
        ok: true,
        text: notifyGuest
          ? `Community ${alertType} alert logged.${notice}`
          : alertType === "test"
            ? "Test alert stored. Check the host WhatsApp/SMS inbox."
            : `Community ${alertType} alert logged.`,
      });
      if (data.alert && !String(data.alert.id).startsWith("demo")) {
        await load();
      }
    } catch (cause) {
      setFeedback({ ok: false, text: cause instanceof Error ? cause.message : "Alert failed." });
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Community alert board</h2>
        <p className="mt-2 text-base text-slate-600">
          Log neighbor complaints for noise, parking, or trash, then fire a house-rules notice to the in-stay guest.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            placeholder="Property ID (e.g. prop-1)"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional neighbor note"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {COMMUNITY_ALERT_TYPES.map((type: CommunityAlertType) => (
            <button
              key={type}
              type="button"
              onClick={() => void postAlert(type, true)}
              disabled={sending !== null}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {sending === `${type}:guest` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
              Notify guest · {TYPE_LABEL[type]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void postAlert("test", false)}
            disabled={sending !== null}
            className="flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
          >
            {sending === "test:log" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Host path test
          </button>
        </div>
        {feedback ? (
          <p
            className={`mt-4 rounded-xl border px-4 py-3 text-sm ${feedback.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>

      <h2 className="text-2xl font-bold text-slate-900">Recent community alerts</h2>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-left text-base">
          <thead className="border-b border-slate-300 bg-slate-100 text-sm font-semibold uppercase tracking-wide text-slate-900">
            <tr>
              <th className="px-6 py-5">When</th>
              <th className="px-6 py-5">Type</th>
              <th className="px-6 py-5">Property</th>
              <th className="px-6 py-5">Message</th>
              <th className="px-6 py-5">Guest notice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {alerts.map((alert) => (
              <tr key={alert.id} className="align-top transition-colors hover:bg-slate-50">
                <td className="px-6 py-6 text-slate-900">{new Date(alert.created_at).toLocaleString("en-US")}</td>
                <td className="px-6 py-6">
                  <span
                    className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${TYPE_STYLE[alert.alert_type] ?? TYPE_STYLE.test}`}
                  >
                    {TYPE_LABEL[alert.alert_type] ?? alert.alert_type}
                    {alert.is_test ? " · TEST" : ""}
                  </span>
                </td>
                <td className="px-6 py-6 font-mono text-sm text-slate-900">{alert.property_id ?? "—"}</td>
                <td className="px-6 py-6 whitespace-pre-wrap text-slate-900">{alert.message}</td>
                <td className="px-6 py-6">
                  {alert.is_test ? (
                    <span className="text-slate-700">—</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void postAlert(alert.alert_type, true, alert.message)}
                      disabled={sending !== null}
                      className="rounded-lg border border-emerald-800 bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      Notify guest
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {alerts.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-lg text-slate-700">
                  No community alerts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
