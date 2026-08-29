import type { NextConfig } from "next";

/** Public Supabase keys come from `.env.local` (NEXT_PUBLIC_SUPABASE_*). Do not hardcode them here. */
const nextConfig: NextConfig = {
  // Phone / Cloudflare tunnels load /_next/static from a different host than localhost.
  allowedDevOrigins: ["10.0.0.74", "*.trycloudflare.com", "*.loca.lt"],
  // Expose PUBLIC_APP_URL to the client so guest QR codes can target a tunnel/HTTPS host.
  env: {
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL ?? "",
  },
  // Next 16 removed appIsrStatus / buildActivity. `false` hides the on-screen route indicator.
  // Restart `next dev` after changing this. The "N Issues" badge is also hidden in globals.css.
  devIndicators: false,
};

export default nextConfig;
