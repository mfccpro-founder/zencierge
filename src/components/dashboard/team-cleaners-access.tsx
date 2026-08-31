"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { HousekeepingStaffLinkCard } from "@/components/dashboard/housekeeping-staff-link-card";

type TeamRole = "cleaner" | "cohost" | "inspector";

type TeamMember = {
  id: string;
  email: string;
  role: TeamRole;
  status: "active" | "pending";
};

const STORAGE_KEY = "zencierge.hub.team";

const ROLE_LABEL: Record<TeamRole, string> = {
  cleaner: "Cleaner",
  cohost: "Co-host",
  inspector: "Inspector",
};

const ROLE_PERMS: Record<TeamRole, string> = {
  cleaner: "Housekeeping cards and photo uploads only. No financials or settings.",
  cohost: "Listings, calendar, NeighborShield, and Dispute Dossier. No billing.",
  inspector: "Inspection gallery and damage flags. No guest PII export.",
};

const DEFAULT_TEAM: TeamMember[] = [
  { id: "tm-1", email: "marisol@cleanco.example", role: "cleaner", status: "active" },
  { id: "tm-2", email: "ops@sunshine-turnovers.example", role: "cleaner", status: "pending" },
];

const field =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none";

function readTeam(): TeamMember[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TEAM;
    const parsed = JSON.parse(raw) as TeamMember[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_TEAM;
  } catch {
    return DEFAULT_TEAM;
  }
}

export function TeamCleanersAccessPanel() {
  const [team, setTeam] = useState<TeamMember[]>(DEFAULT_TEAM);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("cleaner");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setTeam(readTeam());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const persist = (next: TeamMember[]) => {
    setTeam(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const invite = () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes("@")) return;
    persist([
      ...team,
      { id: `tm-${Date.now()}`, email, role: inviteRole, status: "pending" },
    ]);
    setInviteEmail("");
    setToast("Invite saved on this device.");
  };

  return (
    <div className="space-y-4">
      <HousekeepingStaffLinkCard />
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-sky-700" />
            <h2 className="text-lg font-bold text-slate-900">Team &amp; cleaners access</h2>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-800">
            Invite cleaning crew or co-hosts with role-based permissions. Share the public upload link above for phone
            turnovers.
          </p>
        </div>
        {toast ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
            {toast}
          </p>
        ) : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_160px_auto]">
          <input
            type="email"
            className={field}
            placeholder="crew@example.com"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
          />
          <select
            className={field}
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as TeamRole)}
          >
            <option value="cleaner">Cleaner</option>
            <option value="cohost">Co-host</option>
            <option value="inspector">Inspector</option>
          </select>
          <button
            type="button"
            onClick={invite}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
          >
            <Plus className="h-4 w-4" /> Invite
          </button>
        </div>
        <p className="mt-3 text-xs font-medium text-slate-800">{ROLE_PERMS[inviteRole]}</p>
        <ul className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {team.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-slate-900">{member.email}</p>
                <p className="text-xs font-medium text-slate-800">
                  {ROLE_LABEL[member.role]} · {member.status === "active" ? "Active" : "Invite pending"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => persist(team.filter((row) => row.id !== member.id))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            persist(team);
            setToast("Team list saved.");
          }}
          className="mt-6 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700"
        >
          Save Changes
        </button>
      </section>
    </div>
  );
}
