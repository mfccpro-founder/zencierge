"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";
import { clearPendingSignup } from "@/lib/pending-signup";

export function HostSignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void (async () => {
          try {
            await fetch("/api/auth/dev-session", { method: "DELETE" });
          } catch {
            /* ignore */
          }
          try {
            await fetch("/api/auth/pending-host", { method: "DELETE" });
          } catch {
            /* ignore */
          }
          clearPendingSignup();
          try {
            const supabase = createAuthBrowserClient();
            await supabase.auth.signOut();
          } catch {
            /* local preview has no live GoTrue session */
          }
          window.location.assign("/login");
        })();
      }}
      className={
        className ??
        "mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 py-2 text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:border-slate-700 disabled:opacity-60"
      }
    >
      <LogOut className="h-3.5 w-3.5" />
      Sign out
    </button>
  );
}
