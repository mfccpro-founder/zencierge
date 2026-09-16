import Link from "next/link";
import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

function maskUuid(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 12) return "…";
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

/**
 * Sandbox/dev-only auth status for B4C.
 * Does not forge sessions, inject user_id, or use service role in the browser.
 */
export async function SquareSubscriptionAuthStatus({
  intentId,
  enrollEnabled,
}: {
  intentId: string;
  enrollEnabled: boolean;
}) {
  const supabase = await createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let intentOwnerUserId: string | null = null;
  let intentLookup: "ok" | "skipped" | "failed" = "skipped";

  if (enrollEnabled) {
    const admin = tryCreateSupabaseAdminClient();
    if (!admin) {
      intentLookup = "failed";
    } else {
      const { data, error } = await admin
        .from("square_subscription_intents")
        .select("user_id")
        .eq("id", intentId)
        .maybeSingle();
      if (error || !data?.user_id) {
        intentLookup = "failed";
      } else {
        intentLookup = "ok";
        intentOwnerUserId = data.user_id as string;
      }
    }
  }

  const sessionPresent = Boolean(user?.id);
  const matchesOwner =
    sessionPresent &&
    intentOwnerUserId !== null &&
    user!.id === intentOwnerUserId;

  const returnPath = `/dev/square-subscription-test?intentId=${encodeURIComponent(intentId)}`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  return (
    <section className="rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm text-slate-300">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-400/90">
        Auth status · B4C sandbox
      </p>
      <ul className="mt-2 space-y-1">
        <li>
          Session:{" "}
          <span className={sessionPresent ? "text-emerald-300" : "text-rose-300"}>
            {sessionPresent ? "signed in (Supabase getUser)" : "not signed in → subscribe returns 401"}
          </span>
        </li>
        <li>
          Session user:{" "}
          <span className="font-mono text-xs text-slate-200">
            {sessionPresent && user?.id ? maskUuid(user.id) : "—"}
          </span>
        </li>
        <li>
          Intent owner:{" "}
          <span className="font-mono text-xs text-slate-200">
            {intentLookup === "ok" && intentOwnerUserId
              ? maskUuid(intentOwnerUserId)
              : intentLookup === "failed"
                ? "lookup failed"
                : "n/a (placeholder intent)"}
          </span>
        </li>
        <li>
          Match:{" "}
          <span
            className={
              matchesOwner
                ? "text-emerald-300"
                : sessionPresent
                  ? "text-amber-300"
                  : "text-rose-300"
            }
          >
            {matchesOwner
              ? "session user matches intent owner"
              : sessionPresent
                ? "session user does NOT match intent owner"
                : "no session — cannot enroll"}
          </span>
        </li>
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        Use the real host login (password for the sandbox auth user). Do not use
        “local preview” — that mock user will not pass{" "}
        <code className="text-slate-300">getUser()</code> on{" "}
        <code className="text-slate-300">/api/payments/square/subscribe</code>.
      </p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link
          href={loginHref}
          className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 font-medium text-amber-100 hover:border-amber-500/70"
        >
          Sign in via /login
        </Link>
        {enrollEnabled ? (
          <Link
            href={returnPath}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500"
          >
            Refresh this page
          </Link>
        ) : null}
      </div>
    </section>
  );
}
