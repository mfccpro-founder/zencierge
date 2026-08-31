import type { NextConfig } from "next";
import { lanIpv4Addresses } from "./src/lib/lan-ipv4";
import { configuredPublicHostname } from "./src/lib/public-app-url";

const publicAppUrl =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_SECURE_ORIGIN ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.PUBLIC_APP_URL ||
  "";
const publicHostname = configuredPublicHostname();

/** Public Supabase keys come from `.env.local` (NEXT_PUBLIC_SUPABASE_*). Do not hardcode them here. */
const nextConfig: NextConfig = {
  // Phone / LAN IP / Cloudflare tunnels load /_next/static from a different host than localhost.
  allowedDevOrigins: [
    ...lanIpv4Addresses(),
    ...(publicHostname ? [publicHostname] : []),
    "*.trycloudflare.com",
    "*.loca.lt",
    "*.localtunnel.me",
    "*.ngrok-free.app",
    "*.ngrok.io",
  ],
  // Guest QR, check-in links, and voice use this HTTPS origin when set.
  env: {
    PUBLIC_APP_URL: publicAppUrl,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || publicAppUrl,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || publicAppUrl,
    NEXT_PUBLIC_SECURE_ORIGIN: process.env.NEXT_PUBLIC_SECURE_ORIGIN || publicAppUrl,
  },
  // Next 16 removed appIsrStatus / buildActivity. `false` hides the on-screen route indicator.
  // Restart `next dev` after changing this. The "N Issues" badge is also hidden in globals.css.
  devIndicators: false,
};

export default nextConfig;
