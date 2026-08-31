import { NextResponse } from "next/server";
import { preferredLanIpv4 } from "@/lib/lan-ipv4";
import { readDevTunnelOrigin } from "@/lib/dev-tunnel";
import {
  configuredPublicOrigin,
  configuredSecureOrigin,
  isLoopbackHostname,
} from "@/lib/public-app-url";

export const dynamic = "force-dynamic";

function parseHost(hostHeader: string): { hostname: string; port: string | null } {
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    const hostname = hostHeader.slice(1, Math.max(end, 1));
    const rest = hostHeader.slice(end + 1);
    return { hostname, port: rest.startsWith(":") ? rest.slice(1) : null };
  }
  const colon = hostHeader.lastIndexOf(":");
  if (colon > 0 && hostHeader.indexOf(":") === colon) {
    return { hostname: hostHeader.slice(0, colon), port: hostHeader.slice(colon + 1) };
  }
  return { hostname: hostHeader, port: null };
}

function originFor(protocol: string, hostname: string, port: string | null) {
  const hidePort =
    (protocol === "https" && (port === "443" || !port)) ||
    (protocol === "http" && (port === "80" || !port));
  const suffix = hidePort || !port ? "" : `:${port}`;
  return `${protocol}://${hostname}${suffix}`;
}

export async function GET(request: Request) {
  const fromEnv = configuredSecureOrigin() ?? configuredPublicOrigin();
  if (fromEnv) {
    let hostname = fromEnv;
    try {
      hostname = new URL(fromEnv).hostname;
    } catch {
      /* keep origin string */
    }
    return NextResponse.json({
      origin: fromEnv,
      hostname,
      source: "env",
    });
  }

  const tunnel = readDevTunnelOrigin();
  if (tunnel) {
    let hostname = tunnel;
    try {
      hostname = new URL(tunnel).hostname;
    } catch {
      /* keep origin string */
    }
    return NextResponse.json({
      origin: tunnel,
      hostname,
      source: "tunnel",
    });
  }

  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader =
    forwardedHost?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  const protocol = (
    request.headers.get("x-forwarded-proto") ||
    url.protocol.replace(":", "")
  )
    .split(",")[0]
    .trim();

  const parsed = parseHost(hostHeader);
  const requestPort = parsed.port || url.port || (protocol === "https" ? "443" : "3000");
  const lan = preferredLanIpv4();
  const hostname = isLoopbackHostname(parsed.hostname)
    ? (lan ?? parsed.hostname)
    : parsed.hostname;

  return NextResponse.json({
    origin: originFor(protocol, hostname, requestPort),
    hostname,
    source: "lan",
  });
}
