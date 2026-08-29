"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Lightbulb, List, Search } from "lucide-react";

type GuideModule = {
  id: string;
  title: string;
  href: string;
  summary: string;
  lifecycle: string[];
  steps: { title: string; body: string }[];
  tips: string[];
};

const MODULES: GuideModule[] = [
  {
    id: "properties",
    title: "Properties & Elena AI",
    href: "/dashboard/properties",
    summary:
      "Your listing command center. Keep door codes, Wi-Fi, parking, occupancy, and Elena’s property handbook current so every guest call is grounded in real unit facts.",
    lifecycle: [
      "Add or open a listing and confirm address, check-in, and check-out times.",
      "Save access details: door code, smart lock, gate, parking, and trash instructions.",
      "Write the AI handbook in plain English. Elena reads this on every guest call.",
      "Share the guest QR / portal link so arrivals can self-check-in without texting you.",
    ],
    steps: [
      {
        title: "Open Properties & Elena AI",
        body: "From Host OS, go to Properties & Elena AI. Select the listing you are updating.",
      },
      {
        title: "Keep access facts exact",
        body: "Door codes, Wi-Fi names, and parking notes must match what is on-site. Elena will speak these values to guests. Update them the same day you change a lock or network.",
      },
      {
        title: "Refresh the handbook after any house-rule change",
        body: "Quiet hours, pool heat, occupancy caps, and escalation rules belong in the handbook. Short, factual sentences work better than marketing copy.",
      },
    ],
    tips: [
      "If a guest is calling about a lockout, confirm the live door code in Properties before you call them back.",
      "Use Request a Feature if you need a field Elena cannot see yet (for example, EV charger instructions).",
    ],
  },
  {
    id: "housekeeping",
    title: "Housekeeping",
    href: "/dashboard/housekeeping",
    summary:
      "Track every unit through checkout, cleaning, photo inspection, and next arrival. Use the gallery to prove condition and send damage shots to Dispute Dossier.",
    lifecycle: [
      "Guest Checked Out — guest has departed; the unit is ready for cleaning.",
      "Turnover in Progress — the housekeeper is on-site.",
      "Inspected & Verified — pre/post photos are in with timestamps.",
      "Ready for Check-in — the unit is staged and clear for the next guest.",
    ],
    steps: [
      {
        title: "Filter the portfolio",
        body: "Use search and status chips (Ready for Check-in, Guest Checked Out, Turnover in Progress, Inspected) to focus a 7+ listing day.",
      },
      {
        title: "Open the inspection gallery",
        body: "On a property card, click View Photos (Pre-Checkin & Post-Checkout). Section A is checkout condition and damage. Section B is turn-ready beds, baths, kitchen, and staging.",
      },
      {
        title: "Send damage to claims",
        body: "On a pre-cleaning photo that shows damage, click Send to Dispute Dossier. Zencierge attaches the caption, timestamp, and image to the forensic exhibit builder.",
      },
    ],
    tips: [
      "Click a thumbnail to zoom. Timestamps are part of your AirCover chain of custody — do not crop them out of exports.",
      "If a turnover has no photos yet, the gallery will say so. Ask the cleaner to upload before you mark the unit Ready for Check-in.",
    ],
  },
  {
    id: "guest-dna",
    title: "Guest DNA",
    href: "/dashboard/guest-dna",
    summary:
      "Identity and risk captured at the guest check-in gate. Use it as your direct-booking pipeline and as the source of truth for who actually stayed.",
    lifecycle: [
      "Guest opens the property QR / verification flow.",
      "ID and selfie (where required) lock identity for the stay.",
      "Zencierge stores name, email, phone, and property ID.",
      "Risk tags (chargeback, false dispute, watch, clear) help you decide on future bookings.",
    ],
    steps: [
      {
        title: "Open Guest DNA",
        body: "Go to Guest DNA in Host OS. Review guests captured at the gate, not only names from the OTA inbox.",
      },
      {
        title: "Read risk tags first",
        body: "Chargeback and false-dispute tags are early warning. Pair them with NeighborShield and Dispute Dossier if the same stay goes sideways.",
      },
      {
        title: "Prefill a claim",
        body: "In Dispute Dossier, use Prefill from captured guest so the forensic report uses the legal name and contact captured at check-in.",
      },
    ],
    tips: [
      "Direct leads live here. After a five-star stay, you already have email and phone without scraping Airbnb messages.",
      "If a guest never completed verification, treat access as incomplete until the gate is done.",
    ],
  },
  {
    id: "neighbor-shield",
    title: "NeighborShield",
    href: "/dashboard/neighbor-shield",
    summary:
      "Community complaints for noise, parking, and trash — with a one-click house-rules notice to the guest who is currently in the unit.",
    lifecycle: [
      "A neighbor or HOA reports an issue.",
      "You log the complaint against the listing and stay window.",
      "Send the in-stay guest a house-rules notice in one click.",
      "Keep the timestamped trail for Quiet Hours enforcement and, if needed, Dispute Dossier.",
    ],
    steps: [
      {
        title: "Open NeighborShield",
        body: "Go to NeighborShield. Review open complaints and which listing they belong to.",
      },
      {
        title: "Notify the in-stay guest",
        body: "Use the house-rules notice so the guest of record is told to stop the violation. Do this before you escalate to the OTA.",
      },
      {
        title: "Attach to a claim if it continues",
        body: "Copy complaint times into Dispute Dossier evidence notes. AirCover expects a duty-to-mitigate trail.",
      },
    ],
    tips: [
      "Quiet hours in Settings should match what you print in the handbook and what NeighborShield enforces.",
      "Never argue with a neighbor in the guest thread. Keep the guest notice factual and short.",
    ],
  },
  {
    id: "dispute-dossier",
    title: "Dispute Dossier",
    href: "/dashboard/dispute-dossier",
    summary:
      "Build a forensic exhibit for AirCover or OTA Trust & Safety: identity lock, timeline, mitigation, dollar amount, and a printable evidence index.",
    lifecycle: [
      "Identify the guest (Guest DNA) and the listing.",
      "Record incident date, time, and category (damage, party, smoking, and so on).",
      "Attach photos (including housekeeping pre-clean shots) and NeighborShield timestamps.",
      "Export TXT or print to PDF. Do not edit the exhibit after you upload it to the OTA.",
    ],
    steps: [
      {
        title: "Open Dispute Dossier",
        body: "Go to Dispute Dossier. Prefill from a captured guest when possible so names match check-in.",
      },
      {
        title: "Write a neutral narrative",
        body: "Describe what you observed, not what you felt. Include messages sent and calls made (duty to mitigate).",
      },
      {
        title: "Export the pack",
        body: "Use Export Report (.txt) or Print / Save as PDF. The exhibit ID and UTC generated time support chain of custody.",
      },
    ],
    tips: [
      "Housekeeping’s Send to Dispute Dossier button drops the photo caption, timestamp, and URL into Evidence attached.",
      "Set category to Property damage when the claim is about checkout condition, not a noise complaint.",
    ],
  },
  {
    id: "financials",
    title: "Financials",
    href: "/dashboard/financials",
    summary:
      "Revenue command center for Florida listings: net profit, ADR, occupancy, and payouts across Airbnb and Vrbo.",
    lifecycle: [
      "Payouts and reservation revenue land from your connected books.",
      "Review occupancy and ADR by listing.",
      "Mark or reconcile paid items as you close the month.",
      "Use the numbers when you decide on pricing, gaps, or Superhost plan upgrades.",
    ],
    steps: [
      {
        title: "Open Financials",
        body: "From the command center choose Financials, or open /dashboard/financials. Scan portfolio KPIs first, then drill into a listing.",
      },
      {
        title: "Check occupancy vs. ADR together",
        body: "High occupancy with falling ADR can still look busy while profit shrinks. Use both before you cut rates.",
      },
      {
        title: "Keep payouts labeled",
        body: "Confirm paid vs. pending so you do not spend money that has not cleared.",
      },
    ],
    tips: [
      "Turnover labor and restock belong in your head even when they are not in this view yet. Request a Feature if you need cleaner P&L lines.",
      "Florida seasonality is real. Compare the same month last year before you panic at a shoulder-season dip.",
    ],
  },
  {
    id: "voice",
    title: "Voice Concierge",
    href: "/dashboard/voice-agent",
    summary:
      "Elena, your AI receptionist: avatar, live call tools, and handbook grounding so guests get the right code and the right house rule in English (and Spanish when they speak Spanish).",
    lifecycle: [
      "A guest calls your Florida voice line.",
      "Elena answers with the listing handbook and access facts.",
      "Lockouts, leaks, and emergencies escalate to you per Settings.",
      "You can open Voice Concierge in the command center to watch the avatar and call tools.",
    ],
    steps: [
      {
        title: "Open Voice Concierge",
        body: "In the Host Command Center sidebar, choose Voice Concierge (Avatar). Confirm the voice line shown at the bottom of the sidebar.",
      },
      {
        title: "Ground Elena in the handbook",
        body: "If she says the wrong code, the listing handbook or Properties access fields are stale. Fix those first — do not only change Settings keys.",
      },
      {
        title: "Configure the engine in Settings",
        body: "Voice & Phone holds Twilio, Florida DID (305 / 954), OpenAI Realtime or ElevenLabs, and quiet hours. Test after every key rotation.",
      },
    ],
    tips: [
      "Quiet hours in Settings should match NeighborShield and the guest handbook.",
      "Never put your personal cell in the handbook. Elena should escalate, not dox you.",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    href: "/dashboard/settings",
    summary:
      "Account, voice and phone, notifications and escalations, and Pro Superhost billing. This is where Elena’s line, quiet hours, and plan live.",
    lifecycle: [
      "Confirm account identity and plan.",
      "Set Florida voice line, Twilio, and voice vendor keys.",
      "Turn on SMS / WhatsApp alerts and your emergency callback number.",
      "Enable quiet hours so Elena and alerts respect 10:00 PM–8:00 AM (or your window).",
    ],
    steps: [
      {
        title: "Open Settings",
        body: "Use Settings in the command center sidebar or the top Host OS bar. Tabs cover Account, Voice & Phone, Notifications & Escalations, and Plan & Billing.",
      },
      {
        title: "Save voice credentials carefully",
        body: "Rotate keys in the vendor dashboard, then paste them here. Use show/hide secrets when someone is looking over your shoulder.",
      },
      {
        title: "Upgrade only when you need the cap",
        body: "Plan & Billing shows Starter vs. higher tiers. Voice minutes have a cap — watch usage before a holiday weekend.",
      },
    ],
    tips: [
      "After changing quiet hours, say them out loud in the listing handbook so Elena and the printed house rules match.",
      "Use Request a Feature for billing or alert channels Zencierge does not support yet.",
    ],
  },
];

export function HostUserGuide() {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return MODULES;
    return MODULES.filter((mod) => {
      const blob = [
        mod.title,
        mod.summary,
        ...mod.lifecycle,
        ...mod.steps.map((step) => `${step.title} ${step.body}`),
        ...mod.tips,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [query]);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 mb-2 border-b border-slate-200 bg-slate-50/95 pb-4 pt-2 backdrop-blur-sm">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the knowledge base (module, step, or tip)..."
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-900">
            <List className="h-3.5 w-3.5" /> Table of contents
          </p>
          <ol className="mt-3 space-y-1">
            {MODULES.map((mod, index) => {
              const hidden = query.trim() !== "" && !visible.some((row) => row.id === mod.id);
              return (
                <li key={mod.id}>
                  <a
                    href={`#${mod.id}`}
                    className={`block rounded-lg px-2 py-1.5 text-sm font-semibold ${
                      hidden ? "text-slate-400" : "text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    {index + 1}. {mod.title}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="space-y-5">
          {visible.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-900">
              No guide sections match that search. Try a module name such as Housekeeping or Voice Concierge.
            </p>
          ) : (
            visible.map((mod) => (
              <article
                key={mod.id}
                id={mod.id}
                className="scroll-mt-28 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{mod.title}</h2>
                    <p className="mt-1 text-sm font-medium text-slate-800">{mod.summary}</p>
                  </div>
                  <Link
                    href={mod.href}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700"
                  >
                    <BookOpen className="h-3.5 w-3.5" /> Open module
                  </Link>
                </div>
                <div className="grid gap-5 p-5 lg:grid-cols-2">
                  <section>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">Lifecycle</h3>
                    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm font-medium text-slate-900">
                      {mod.lifecycle.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </section>
                  <section>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">Step by step</h3>
                    <ol className="mt-3 space-y-3">
                      {mod.steps.map((step, index) => (
                        <li key={step.title}>
                          <p className="text-sm font-bold text-slate-900">
                            {index + 1}. {step.title}
                          </p>
                          <p className="mt-1 text-sm text-slate-800">{step.body}</p>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
                <div className="border-t border-slate-200 bg-amber-50 px-5 py-4">
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Lightbulb className="h-4 w-4" /> Pro tips
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-medium text-slate-900">
                    {mod.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
