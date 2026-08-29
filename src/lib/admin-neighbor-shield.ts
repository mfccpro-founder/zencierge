export const COMMUNITY_ALERT_TYPES = ["noise", "parking", "trash"] as const;
export type CommunityAlertType = (typeof COMMUNITY_ALERT_TYPES)[number];

export type NeighborAlertRow = {
  id: string;
  property_id: string | null;
  alert_type: string;
  message: string;
  is_test: boolean;
  created_at: string;
  guest_notified?: boolean;
};

export const DEMO_NEIGHBOR_ALERTS: NeighborAlertRow[] = [
  {
    id: "demo-ns-1",
    property_id: "prop-1",
    alert_type: "noise",
    message: "Neighbor reported loud music after 11:00 PM quiet hours.",
    is_test: false,
    created_at: new Date(Date.now() - 36 * 60 * 1000).toISOString(),
    guest_notified: true,
  },
  {
    id: "demo-ns-2",
    property_id: "prop-2",
    alert_type: "parking",
    message: "Vehicle blocking the HOA dumpster access lane.",
    is_test: false,
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    guest_notified: false,
  },
  {
    id: "demo-ns-3",
    property_id: "prop-3",
    alert_type: "trash",
    message: "Overflow bags left beside the community dumpster (wildlife / HOA fine risk).",
    is_test: false,
    created_at: new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString(),
    guest_notified: true,
  },
];

const GUEST_NOTICE: Record<CommunityAlertType, string> = {
  noise:
    "House-rules reminder: quiet hours are in effect. Please lower volume immediately to avoid an HOA complaint and possible early checkout.",
  parking:
    "Parking notice: a vehicle associated with this stay is blocking a reserved or shared space. Please move it now to avoid towing.",
  trash:
    "Waste notice: trash must be bagged and placed inside the designated dumpster. Please correct this now to avoid an HOA fine.",
};

export function isCommunityAlertType(value: string): value is CommunityAlertType {
  return (COMMUNITY_ALERT_TYPES as readonly string[]).includes(value);
}

export function guestNoticeCopy(alertType: CommunityAlertType) {
  return GUEST_NOTICE[alertType];
}

export function defaultCommunityMessage(alertType: CommunityAlertType) {
  if (alertType === "noise") return "Community noise complaint during quiet hours.";
  if (alertType === "parking") return "Community parking / driveway obstruction complaint.";
  return "Community trash / dumpster complaint.";
}
