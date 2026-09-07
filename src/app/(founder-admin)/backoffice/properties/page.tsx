import type { Metadata } from "next";
import { BackOfficeComingNext } from "@/components/admin/backoffice-coming-next";

export const metadata: Metadata = {
  title: "Properties · Zencierge Founder Back Office",
};

export default function BackOfficePropertiesPage() {
  return (
    <BackOfficeComingNext
      title="Properties"
      detail="Coming next · not yet implemented. This route is not part of the primary Founder Back Office menu. Property ownership still powers Customers and Isabela Usage attribution internally."
    />
  );
}
