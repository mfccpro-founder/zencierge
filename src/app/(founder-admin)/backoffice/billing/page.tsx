import type { Metadata } from "next";
import { BackOfficeComingNext } from "@/components/admin/backoffice-coming-next";

export const metadata: Metadata = {
  title: "Billing · Zencierge Founder Back Office",
};

export default function BackOfficeBillingPage() {
  return (
    <BackOfficeComingNext
      title="Billing"
      detail="Plans, complimentary trials, and payment detail will be built on live host_subscriptions data — not the demo Revenue store."
    />
  );
}
