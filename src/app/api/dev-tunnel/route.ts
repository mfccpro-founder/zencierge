import { NextResponse } from "next/server";
import { readDevTunnelOrigin } from "@/lib/dev-tunnel";

export const dynamic = "force-dynamic";

export async function GET() {
  const origin = readDevTunnelOrigin();
  return NextResponse.json({
    origin,
    running: Boolean(origin),
    howTo: [
      "Keep npm run dev running (HTTP on this computer).",
      "In a second terminal run: npm run tunnel",
      "Wait for an https://….trycloudflare.com (or loca.lt) URL.",
      "Refresh the guest QR card and scan it on your phone for Tap to talk.",
    ],
  });
}
