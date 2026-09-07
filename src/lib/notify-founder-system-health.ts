import {
  buildFounderAlertSubject,
  buildFounderAlertText,
  parseFounderAlertEmails,
  type SystemHealthAlertKind,
  type SystemHealthAlertSeverity,
  type SystemHealthAlertTrackedServiceId,
} from "@/lib/admin-system-health-alerts-shared";
import type { SystemHealthStatus } from "@/lib/admin-system-health-shared";
import { configuredPublicOrigin } from "@/lib/public-app-url";

export type FounderSystemHealthNotifyInput = {
  kind: SystemHealthAlertKind;
  severity: SystemHealthAlertSeverity;
  serviceId: SystemHealthAlertTrackedServiceId;
  status: SystemHealthStatus;
  reason: string;
  checkedAt: string;
};

export type FounderSystemHealthNotifyResult =
  | { ok: true; delivered: true; recipients: string[] }
  | { ok: true; delivered: false; unconfigured: true; reason: string }
  | { ok: false; delivered: false; error: string };

/**
 * Founder operational alerts via Resend.
 * Uses FOUNDER_ALERT_EMAILS only — never falls back to Back Office admin allowlist emails.
 */
export async function notifyFounderSystemHealth(
  input: FounderSystemHealthNotifyInput,
): Promise<FounderSystemHealthNotifyResult> {
  const recipients = parseFounderAlertEmails(process.env.FOUNDER_ALERT_EMAILS);
  if (recipients.length === 0) {
    return {
      ok: true,
      delivered: false,
      unconfigured: true,
      reason: "FOUNDER_ALERT_EMAILS is empty or unset",
    };
  }

  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (!resendKey) {
    return {
      ok: true,
      delivered: false,
      unconfigured: true,
      reason: "RESEND_API_KEY is not configured",
    };
  }

  const origin = configuredPublicOrigin() || "https://zencierge.app";
  const systemUrl = `${origin.replace(/\/$/, "")}/backoffice/system`;
  const subject = buildFounderAlertSubject({
    kind: input.kind,
    severity: input.severity,
    serviceId: input.serviceId,
  });
  const text = buildFounderAlertText({
    kind: input.kind,
    severity: input.severity,
    serviceId: input.serviceId,
    status: input.status,
    reason: input.reason,
    checkedAt: input.checkedAt,
    systemUrl,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.FOUNDER_ALERT_FROM?.trim() || "Zencierge <alerts@zencierge.app>",
        to: recipients,
        subject,
        text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("[founder-alerts] Resend rejected", response.status, body.slice(0, 200));
      return {
        ok: false,
        delivered: false,
        error: `Resend HTTP ${response.status}`,
      };
    }

    return { ok: true, delivered: true, recipients };
  } catch (cause) {
    console.warn("[founder-alerts] email notify failed", cause);
    return {
      ok: false,
      delivered: false,
      error: cause instanceof Error ? cause.message : "Resend request failed",
    };
  }
}
