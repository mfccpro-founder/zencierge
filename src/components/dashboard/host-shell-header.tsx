"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Menu, X } from "lucide-react";
import { ZenciergeLogo } from "@/components/brand/zencierge-logo";
import { HostSignOutButton } from "@/components/auth/host-sign-out-button";
import { createAuthBrowserClient } from "@/lib/supabase-auth-browser";
import {
  DEFAULT_HOST_PROFILE_NAME,
  HOST_PROFILE_UPDATED_EVENT,
  hostInitials,
  resolveHostProfileName,
} from "@/lib/host-display-name";
import { readPendingSignup } from "@/lib/pending-signup";
import { useHostShell } from "@/components/dashboard/host-shell-context";
import type { HostAlert } from "@/lib/housekeeping-photos";

const NOTICES = [
  { id: "n1", href: "/dashboard/neighbor-shield", title: "Quiet hours", body: "NeighborShield: noise alert on Miami Beach Loft." },
  { id: "n2", href: "/dashboard/housekeeping?tab=supplies", title: "Supplies", body: "Trash bags below min threshold on Fort Lauderdale Villa." },
  { id: "n3", href: "/dashboard/housekeeping", title: "Turnover", body: "Ocean Drive Loft photos waiting for inspection." },
];

export function HostShellHeader() {
  const { mobileNavOpen, setMobileNavOpen } = useHostShell();
  const [hostName, setHostName] = useState(DEFAULT_HOST_PROFILE_NAME);
  const [bellOpen, setBellOpen] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState<HostAlert[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const applyIdentity = async (user: { id?: string; email?: string | null; user_metadata?: Record<string, unknown> } | null) => {
      const pending = readPendingSignup();
      let fromTable = "";
      if (user?.id) {
        try {
          const supabase = createAuthBrowserClient();
          const { data } = await supabase.from("host_profiles").select("full_name").eq("user_id", user.id).maybeSingle();
          fromTable = typeof data?.full_name === "string" ? data.full_name.trim() : "";
        } catch {
          fromTable = "";
        }
      }
      setHostName(fromTable || resolveHostProfileName(user, pending?.fullName));
    };

    const onProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail.trim()) setHostName(detail.trim());
    };

    try {
      const supabase = createAuthBrowserClient();
      void supabase.auth.getUser().then(({ data }: { data: { user: { id?: string; email?: string | null; user_metadata?: Record<string, unknown> } | null } }) => {
        void applyIdentity(data.user);
      });
      const { data: subscription } = supabase.auth.onAuthStateChange((_event: string, session: { user: { id?: string; email?: string | null; user_metadata?: Record<string, unknown> } | null } | null) => {
        void applyIdentity(session?.user ?? null);
      });
      window.addEventListener(HOST_PROFILE_UPDATED_EVENT, onProfileUpdated);
      return () => {
        subscription.subscription.unsubscribe();
        window.removeEventListener(HOST_PROFILE_UPDATED_EVENT, onProfileUpdated);
      };
    } catch {
      void applyIdentity(null);
      window.addEventListener(HOST_PROFILE_UPDATED_EVENT, onProfileUpdated);
      return () => window.removeEventListener(HOST_PROFILE_UPDATED_EVENT, onProfileUpdated);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/host/alerts", { cache: "no-store" });
        const data = (await response.json()) as { alerts?: HostAlert[] };
        if (!cancelled && Array.isArray(data.alerts)) setLiveAlerts(data.alerts);
      } catch {
        /* keep static notices */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setBellOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, []);

  const initials = hostInitials(hostName || DEFAULT_HOST_PROFILE_NAME);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 md:hidden"
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? "Hide navigation" : "Show navigation"}
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="flex items-center gap-2" data-tour="host-os">
            <ZenciergeLogo className="h-8 w-auto brightness-0" />
            <p className="truncate text-sm font-semibold text-slate-900">Zencierge Host OS</p>
          </div>
        </div>

        <div ref={menuRef} className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBellOpen((open) => !open);
              setProfileOpen(false);
            }}
            className="relative rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
            aria-label="Notifications"
            aria-expanded={bellOpen}
          >
            <Bell className="h-4 w-4" />
            {liveAlerts.length ? (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-600" />
            ) : (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-sky-600" />
            )}
          </button>
          {bellOpen ? (
            <div className="absolute right-12 top-full z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Notifications</p>
              {liveAlerts.map((notice) => (
                <Link
                  key={notice.id}
                  href={notice.href}
                  className="block rounded-lg px-2 py-2 hover:bg-slate-50"
                  onClick={() => setBellOpen(false)}
                >
                  <p className="text-sm font-semibold text-slate-900">{notice.title}</p>
                  <p className="text-xs text-slate-600">{notice.body}</p>
                </Link>
              ))}
              {NOTICES.map((notice) => (
                <Link
                  key={notice.id}
                  href={notice.href}
                  className="block rounded-lg px-2 py-2 hover:bg-slate-50"
                  onClick={() => setBellOpen(false)}
                >
                  <p className="text-sm font-semibold text-slate-900">{notice.title}</p>
                  <p className="text-xs text-slate-600">{notice.body}</p>
                </Link>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setProfileOpen((open) => !open);
              setBellOpen(false);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white"
            aria-label="Profile menu"
            aria-expanded={profileOpen}
          >
            {initials}
          </button>
          {profileOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="truncate text-sm font-semibold text-slate-900">{hostName}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Host account</p>
              <Link
                href="/dashboard/settings"
                className="mt-3 block rounded-lg px-2 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={() => setProfileOpen(false)}
              >
                Settings &amp; subscription
              </Link>
              <HostSignOutButton className="mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60" />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
