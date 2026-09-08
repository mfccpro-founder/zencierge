import os from "node:os";

export function lanIpv4Addresses(): string[] {
  const found: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const ipv4 = addr.family === "IPv4";
      if (!ipv4 || addr.internal) continue;
      found.push(addr.address);
    }
  }

  const rank = (ip: string) => {
    if (ip.startsWith("192.168.")) return 0;
    if (ip.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 2;
    return 3;
  };

  return [...new Set(found)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function preferredLanIpv4(): string | null {
  return lanIpv4Addresses()[0] ?? null;
}
