"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";

export function HostSignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void (async () => {
          const supabase = createAuthBrowserClient();
          await supabase.auth.signOut();
          router.replace("/login");
          router.refresh();
        })();
      }}
      className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 py-2 text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:border-slate-700 disabled:opacity-60"
    >
      <LogOut className="h-3.5 w-3.5" />
      Cerrar sesión
    </button>
  );
}
