import { housekeepingCategoryLabel, type HousekeepingReport } from "@/lib/housekeeping-photos";
import { pushHostAlert } from "@/lib/housekeeping-reports-store";

export async function notifyHostOfHousekeepingReport(report: HousekeepingReport) {
  const label = housekeepingCategoryLabel(report.category);
  const when = new Date(report.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" });
  const title = `${label} · ${report.propertyName}`;
  const body = `${report.photos.length} photo(s) · ${when}${report.staffName ? ` · ${report.staffName}` : ""}${
    report.notes ? ` · ${report.notes.slice(0, 120)}` : ""
  }`;

  const alert = pushHostAlert({
    kind: "housekeeping_report",
    title,
    body,
    href: `/dashboard/housekeeping?tab=reports&property=${encodeURIComponent(report.propertyId)}`,
    reportId: report.id,
    propertyId: report.propertyId,
  });

  const to = (process.env.HOST_NOTIFY_EMAIL || process.env.HOST_ALERT_EMAIL || "").trim();
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (to && resendKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.HOST_NOTIFY_FROM?.trim() || "Zencierge <alerts@zencierge.app>",
          to: [to],
          subject: `Housekeeping photo report: ${title}`,
          text: [
            `Property: ${report.propertyName} (${report.propertyCity})`,
            `Category: ${label}`,
            `When: ${when}`,
            `Staff: ${report.staffName || "Not provided"}`,
            `Photos: ${report.photos.length}`,
            report.notes ? `Notes: ${report.notes}` : "",
            `Open: ${alert.href}`,
            ...report.photos.map((photo, index) => `Photo ${index + 1}: ${photo.imageUrl}`),
          ]
            .filter(Boolean)
            .join("\n"),
        }),
      });
    } catch (cause) {
      console.warn("[housekeeping] email notify failed", cause);
    }
  } else {
    console.info("[housekeeping] host alert stored", title, body);
  }

  return alert;
}
