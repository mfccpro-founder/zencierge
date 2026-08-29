import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-config";

/** Live listings use these env values via supabase-listings. Seed data below is fallback only. */
export { SUPABASE_URL, SUPABASE_ANON_KEY };

export type NavId =
  | "overview"
  | "properties"
  | "calendar"
  | "finances"
  | "voice"
  | "settings";

export type CallStatus =
  | "resolved_ai"
  | "escalated_host"
  | "routed_ops";

export type Call = {
  id: string;
  guest: string;
  property: string;
  time: string;
  duration: string;
  status: CallStatus;
  summary: string;
  transcript: { speaker: "guest" | "ai" | "host"; text: string }[];
};

export type OccupancyStatus = "Occupied" | "Vacant";

export type PropertyCity =
  | "Miami Beach"
  | "Brickell"
  | "Fort Lauderdale"
  | "Sunny Isles";

export const propertyCities: PropertyCity[] = [
  "Miami Beach",
  "Brickell",
  "Fort Lauderdale",
  "Sunny Isles",
];

export type Property = {
  id: string;
  name: string;
  city: PropertyCity;
  address: string;
  status: OccupancyStatus;
  revenue: string;
  doorCode: string;
  smartlock: string;
  wifiNetwork: string;
  wifiPassword: string;
  parking: string;
  gateCode: string;
  checkIn: string;
  checkOut: string;
  currentGuest: string | null;
  /** Trash / recycling instructions for Elena and the guest card. */
  trash: string;
  handbook: string;
};

export const properties: Property[] = [
  {
    id: "prop-1",
    name: "Miami Beach Loft",
    city: "Miami Beach",
    address: "1420 Collins Ave, Unit 5B",
    status: "Occupied",
    revenue: "$4,250",
    doorCode: "4920#",
    smartlock: "Yale Assure SL · Front door",
    wifiNetwork: "Zencierge-Guest",
    wifiPassword: "miami2026",
    parking: "Street permit zone · loading bay on 14th St",
    gateCode: "—",
    checkIn: "3:00 PM (self check-in)",
    checkOut: "11:00 AM",
    currentGuest: "Elena Navarro",
    trash: "City pickup Tuesday and Friday. Place bags in the alley bins before 7:00 AM. No bulk items on the curb.",
    handbook:
      "Greet the guest as the Miami Beach Loft concierge. Wi-Fi is Zencierge-Guest, password miami2026, written on a card in the entry drawer. Door code is 4920#. Self check-in starts at 3:00 PM. Nearest grocery is Publix on Collins Ave, a 3-minute walk. Quiet hours 10:00 PM–8:00 AM. Do not share the host's personal number; escalate lockouts and leaks immediately.",
  },
  {
    id: "prop-2",
    name: "Brickell Modern Suite",
    city: "Brickell",
    address: "901 Brickell Key Blvd, PH-402",
    status: "Occupied",
    revenue: "$3,890",
    doorCode: "7741#",
    smartlock: "August Wi-Fi · Unit 402",
    wifiNetwork: "Brickell-Suite-5G",
    wifiPassword: "key402wifi",
    parking: "Assigned bay #402, Level 2 garage",
    gateCode: "1984#",
    checkIn: "4:00 PM (front desk + keypad)",
    checkOut: "11:00 AM",
    currentGuest: "James Whitaker",
    trash: "Compactor on P1. No bags in the hallway. Recyclables in the blue chute.",
    handbook:
      "You are the Brickell Modern Suite concierge. Parking is bay #402 on Level 2; garage gate code is 1984#. Unit keypad is 7741#. Wi-Fi is Brickell-Suite-5G / key402wifi. Building gym is on P1, 6:00 AM–10:00 PM. Valet is not included. If the guest cannot enter the garage, walk them through the visitor lane and notify the host.",
  },
  {
    id: "prop-3",
    name: "Fort Lauderdale Villa",
    city: "Fort Lauderdale",
    address: "628 SE 7th St",
    status: "Vacant",
    revenue: "$2,640",
    doorCode: "3301#",
    smartlock: "Schlage Encode · Side gate + villa",
    wifiNetwork: "FLL-Villa-Guest",
    wifiPassword: "coralreef26",
    parking: "Driveway, two cars · do not block the alley",
    gateCode: "8820#",
    checkIn: "3:00 PM (side gate then villa door)",
    checkOut: "10:00 AM",
    currentGuest: null,
    trash: "City pickup Tuesday and Friday. Cans at the alley, not the driveway.",
    handbook:
      "You represent Fort Lauderdale Villa. Currently vacant until Léa Martin's Friday arrival. Side-gate code 8820#, villa door 3301#. Wi-Fi FLL-Villa-Guest / coralreef26. Pool heat is host-controlled; do not promise it without checking. AC issues go to ops, not DIY troubleshooting beyond filter and thermostat set to Cool 72°F. Trash pickup Tuesday and Friday.",
  },
  {
    id: "prop-4",
    name: "Sunny Isles Penthouse",
    city: "Sunny Isles",
    address: "17555 Collins Ave, PH-12",
    status: "Occupied",
    revenue: "$1,700",
    doorCode: "1206#",
    smartlock: "RemoteLock 7i · PH elevator + door",
    wifiNetwork: "SunnyIsles-PH",
    wifiPassword: "atlantic1206",
    parking: "Valet drop-off, then tower garage stall P-12",
    gateCode: "5610#",
    checkIn: "4:00 PM (front desk announces PH-12)",
    checkOut: "11:00 AM · late checkout needs host approval",
    currentGuest: "Marcus Chen",
    trash: "Chute on the PH hallway. Recyclables in the labeled room next to the elevator.",
    handbook:
      "You are the Sunny Isles Penthouse concierge. Elevator/door code 1206#. Garage gate 5610#, stall P-12 after valet drop-off. Wi-Fi SunnyIsles-PH / atlantic1206. Late checkout is never authorized by AI — always escalate to Javier. Building quiet hours 11:00 PM. Beach chairs are in the hall closet. Do not discuss other guests in the tower.",
  },
];

/** Public guest portal: always a listing, defaulting to Miami Beach Loft. */
export function guestStayFallback(id: string): Property {
  return properties.find((property) => property.id === id) ?? properties[0]!;
}

export const upcomingCheckins = [
  { guest: "James Whitaker", property: "Brickell Modern Suite", time: "Today, 4:00 PM" },
  { guest: "Elena Navarro", property: "Miami Beach Loft", time: "Tomorrow, 3:00 PM" },
  { guest: "Léa Martin", property: "Fort Lauderdale Villa", time: "Fri, 2:30 PM" },
];

export const calls: Call[] = [
  {
    id: "call-1842",
    guest: "Elena Navarro",
    property: "Miami Beach Loft",
    time: "12 min ago",
    duration: "2:41",
    status: "resolved_ai",
    summary: "Wi-Fi code and self-service check-in time.",
    transcript: [
      {
        speaker: "guest",
        text: "Hi, I can't find the Wi-Fi password and we'll arrive in 20 minutes.",
      },
      {
        speaker: "ai",
        text: "Hello Elena, this is the concierge at Miami Beach Loft. The Wi-Fi is Zencierge-Guest and the password is in the drawer at the entrance: miami2026. Self check-in starts at 3:00 PM.",
      },
      {
        speaker: "guest",
        text: "Perfect, thank you. Is there a supermarket nearby?",
      },
      {
        speaker: "ai",
        text: "Yes, there's a Publix a 3-minute walk away on Collins Ave. Is there anything else I can help you with?",
      },
    ],
  },
  {
    id: "call-1841",
    guest: "Marcus Chen",
    property: "Sunny Isles Penthouse",
    time: "47 min ago",
    duration: "4:08",
    status: "escalated_host",
    summary: "Request for late check-out on Sunday; unauthorized AI.",
    transcript: [
      {
        speaker: "guest",
        text: "Can I get a late checkout on Sunday around 2 PM?",
      },
      {
        speaker: "ai",
        text: "Let me check with the host. I have forwarded your request directly to Javier.",
      },
    ],
  },
  {
    id: "call-1840",
    guest: "Sofia Alves",
    property: "Fort Lauderdale Villa",
    time: "Yesterday, 22:14",
    duration: "3:22",
    status: "routed_ops",
    summary: "Air conditioning not cooling; routed for maintenance.",
    transcript: [
      {
        speaker: "guest",
        text: "The AC unit in the master bedroom is not cooling properly.",
      },
      {
        speaker: "ai",
        text: "I've alerted the maintenance technician. They will visit between 9:00 AM and 11:00 AM tomorrow.",
      },
    ],
  },
  {
    id: "call-1839",
    guest: "James Whitaker",
    property: "Brickell Modern Suite",
    time: "Yesterday, 18:03",
    duration: "1:56",
    status: "resolved_ai",
    summary: "Parking directions and access to the garage.",
    transcript: [
      {
        speaker: "guest",
        text: "Where do I park my rental car?",
      },
      {
        speaker: "ai",
        text: "Assigned spot is #402 on Level 2. Use the gate code 1984# to enter.",
      },
    ],
  },
];

export const metrics = {
  monthlyEarnings: "$12,480",
  earningsTrend: "+18% vs. July · estimated net",
  occupancyRate: "84%",
  occupancyDays: "103 / 124 nights booked",
  upcomingCheckIns: 3,
  checkInsSubtitle: "Today, tomorrow and Friday",
  phoneAssistantStatus: "Live",
  phoneAssistantSub: "IVR ready · 2 free lines",
};

export const operations = [
  { label: "Miami Beach Loft cleaning confirmed 11:00" },
  { label: "Fort Lauderdale Villa Technician 9:00–11:00" },
  { label: "1. Escalation pending late check-out" },
];

export type BookingPlatform = "Airbnb" | "Vrbo" | "Direct";

export type Reservation = {
  id: string;
  propertyId: string;
  guest: string;
  phone: string;
  platform: BookingPlatform;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  accessCode: string;
  aiNotes: string;
  nights: number;
  status: "staying" | "arriving" | "departed" | "upcoming";
};

/** Host-calendar "today" — fixed so SSR and the client match. */
export const calendarToday = "2026-08-26";

export const reservations: Reservation[] = [
  {
    id: "res-elena",
    propertyId: "prop-1",
    guest: "Elena Navarro",
    phone: "+34 612 448 190",
    platform: "Airbnb",
    checkIn: "2026-08-22",
    checkOut: "2026-08-28",
    checkInTime: "3:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "4920#",
    aiNotes:
      "Called about Wi-Fi on Aug 26. Shared Zencierge-Guest / miami2026 and self check-in at 3:00 PM. Publix on Collins mentioned. No open escalations.",
    nights: 6,
    status: "staying",
  },
  {
    id: "res-james",
    propertyId: "prop-2",
    guest: "James Whitaker",
    phone: "+1 (305) 441-8820",
    platform: "Direct",
    checkIn: "2026-08-26",
    checkOut: "2026-08-30",
    checkInTime: "4:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "7741#",
    aiNotes:
      "Arriving today. Yesterday the AI walked him through bay #402 and gate 1984#. Watch for front-desk delay after 4:00 PM.",
    nights: 4,
    status: "arriving",
  },
  {
    id: "res-marcus",
    propertyId: "prop-4",
    guest: "Marcus Chen",
    phone: "+1 (786) 555-0142",
    platform: "Vrbo",
    checkIn: "2026-08-24",
    checkOut: "2026-08-31",
    checkInTime: "4:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "1206#",
    aiNotes:
      "Requested late checkout Sunday ~2:00 PM. AI must not authorize — escalated to Javier. Stay close to the host line.",
    nights: 7,
    status: "staying",
  },
  {
    id: "res-sofia",
    propertyId: "prop-3",
    guest: "Sofia Alves",
    phone: "+55 11 98821-4402",
    platform: "Airbnb",
    checkIn: "2026-08-20",
    checkOut: "2026-08-25",
    checkInTime: "3:00 PM",
    checkOutTime: "10:00 AM",
    accessCode: "3301#",
    aiNotes:
      "AC in master was not cooling. Routed to ops; technician 9:00–11:00 on Aug 26. Unit vacant until Léa Martin Friday.",
    nights: 5,
    status: "departed",
  },
  {
    id: "res-lea",
    propertyId: "prop-3",
    guest: "Léa Martin",
    phone: "+33 6 18 44 02 91",
    platform: "Airbnb",
    checkIn: "2026-08-28",
    checkOut: "2026-09-02",
    checkInTime: "2:30 PM",
    checkOutTime: "10:00 AM",
    accessCode: "3301#",
    aiNotes:
      "Friday arrival. Confirm side-gate 8820# and villa 3301# after the post-Sofia clean. Do not promise pool heat.",
    nights: 5,
    status: "upcoming",
  },
  {
    id: "res-daniel",
    propertyId: "prop-1",
    guest: "Daniel Cruz",
    phone: "+1 (954) 220-1188",
    platform: "Vrbo",
    checkIn: "2026-08-29",
    checkOut: "2026-09-03",
    checkInTime: "3:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "4920#",
    aiNotes:
      "Turnover after Elena on the 28th. Same loft codes. Quiet hours 10:00 PM–8:00 AM.",
    nights: 5,
    status: "upcoming",
  },
  {
    id: "res-priya",
    propertyId: "prop-2",
    guest: "Priya Shah",
    phone: "+1 (917) 555-0164",
    platform: "Airbnb",
    checkIn: "2026-09-02",
    checkOut: "2026-09-06",
    checkInTime: "4:00 PM",
    checkOutTime: "11:00 AM",
    accessCode: "7741#",
    aiNotes:
      "Gap night Sep 1 after James. AI should mention garage gate 1984# and gym P1 on arrival call.",
    nights: 4,
    status: "upcoming",
  },
];

export type IcalFeed = {
  id: string;
  propertyId: string;
  airbnbUrl: string;
  vrboUrl: string;
};

export type PayoutStatus = "Paid" | "Pending Transfer";

export type SettlementRow = {
  propertyId: string;
  owner: string;
  nights: number;
  adr: number;
  gross: number;
  commissionRate: number;
  expenses: number;
  status: PayoutStatus;
};

export type FinancePeriodId = "august" | "ytd";

export const financePeriods: Record<
  FinancePeriodId,
  { label: string; settlements: SettlementRow[] }
> = {
  august: {
    label: "Current Month · August 2026",
    settlements: [
      {
        propertyId: "prop-1",
        owner: "Camila Reyes",
        nights: 22,
        adr: 193,
        gross: 4250,
        commissionRate: 0.18,
        expenses: 380,
        status: "Paid",
      },
      {
        propertyId: "prop-2",
        owner: "North Bay Holdings LLC",
        nights: 20,
        adr: 195,
        gross: 3890,
        commissionRate: 0.18,
        expenses: 340,
        status: "Paid",
      },
      {
        propertyId: "prop-3",
        owner: "Martin Family",
        nights: 16,
        adr: 165,
        gross: 2640,
        commissionRate: 0.18,
        expenses: 290,
        status: "Pending Transfer",
      },
      {
        propertyId: "prop-4",
        owner: "Chen Family Trust",
        nights: 11,
        adr: 155,
        gross: 1700,
        commissionRate: 0.18,
        expenses: 170,
        status: "Pending Transfer",
      },
    ],
  },
  ytd: {
    label: "Year-to-Date 2026",
    settlements: [
      {
        propertyId: "prop-1",
        owner: "Camila Reyes",
        nights: 168,
        adr: 208,
        gross: 34940,
        commissionRate: 0.18,
        expenses: 2840,
        status: "Paid",
      },
      {
        propertyId: "prop-2",
        owner: "North Bay Holdings LLC",
        nights: 154,
        adr: 201,
        gross: 30950,
        commissionRate: 0.18,
        expenses: 2460,
        status: "Paid",
      },
      {
        propertyId: "prop-3",
        owner: "Martin Family",
        nights: 121,
        adr: 172,
        gross: 20810,
        commissionRate: 0.18,
        expenses: 1980,
        status: "Paid",
      },
      {
        propertyId: "prop-4",
        owner: "Chen Family Trust",
        nights: 96,
        adr: 188,
        gross: 18050,
        commissionRate: 0.18,
        expenses: 1520,
        status: "Pending Transfer",
      },
    ],
  },
};

export function settlementNet(row: SettlementRow) {
  return row.gross - row.gross * row.commissionRate - row.expenses;
}

export function settlementCommission(row: SettlementRow) {
  return row.gross * row.commissionRate;
}

export const icalFeeds: IcalFeed[] = [
  {
    id: "feed-1",
    propertyId: "prop-1",
    airbnbUrl: "https://www.airbnb.com/calendar/ical/4882101.ics",
    vrboUrl: "https://www.vrbo.com/icalendar/mbl-5b.ics",
  },
  {
    id: "feed-2",
    propertyId: "prop-2",
    airbnbUrl: "https://www.airbnb.com/calendar/ical/5128834.ics",
    vrboUrl: "https://www.vrbo.com/icalendar/brickell-402.ics",
  },
  {
    id: "feed-3",
    propertyId: "prop-3",
    airbnbUrl: "https://www.airbnb.com/calendar/ical/6012290.ics",
    vrboUrl: "",
  },
  {
    id: "feed-4",
    propertyId: "prop-4",
    airbnbUrl: "",
    vrboUrl: "https://www.vrbo.com/icalendar/sunny-ph12.ics",
  },
];