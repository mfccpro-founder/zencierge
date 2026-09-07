/**
 * Free public HTTPS tunnel to this machine's Next.js HTTP server (port 3000).
 * Keep `npm run dev` running. Phones use the saved HTTPS origin for Tap to talk.
 * Does not change the local server — it stays HTTP on localhost / LAN IPs.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".data", "dev-tunnel.json");
const PORT = process.env.PORT || "3000";
const URL_RE =
  /https:\/\/[a-z0-9.-]+\.(trycloudflare\.com|loca\.lt|localtunnel\.me|ngrok-free\.app|ngrok\.io)/i;
const URL_WATCH_MS = 90_000;
const BUFFER_MAX = 64_000;

function save(origin, provider) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      { origin: origin.replace(/\/$/, ""), provider, updatedAt: new Date().toISOString() },
      null,
      2,
    ),
    "utf8",
  );
  console.log("");
  console.log("[tunnel] HTTPS origin saved for phones.");
  console.log("[tunnel] Keep this window open. Refresh the guest QR card, then scan on your phone.");
  console.log("[tunnel] Local HTTP and LAN addresses are unchanged.");
  console.log("");
}

function clear() {
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function sanitizeTunnelText(text) {
  return text.replace(URL_RE, "[https-origin]");
}

function npxInvocation(extraArgs) {
  const bundled = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(bundled)) {
    return { command: process.execPath, args: [bundled, ...extraArgs] };
  }
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: extraArgs,
  };
}

function start(command, args) {
  return spawn(command, args, {
    cwd: root,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function terminateTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

function watch(child, provider) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let found = "";
    let buffer = "";
    let timer;

    const succeed = () => {
      if (settled || !found) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ child, found });
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      terminateTree(child);
      reject(new Error(message));
    };
    const onChunk = (buf) => {
      const text = buf.toString();
      process.stdout.write(sanitizeTunnelText(text));
      buffer = (buffer + text).slice(-BUFFER_MAX);
      const match = buffer.match(URL_RE);
      if (match && !found) {
        found = match[0];
        save(found, provider);
        succeed();
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (cause) => fail(cause instanceof Error ? cause.message : String(cause)));
    child.on("exit", (code) => {
      if (found) succeed();
      else fail(`${provider} exited (${code ?? "?"}) before publishing an HTTPS URL.`);
    });
    timer = setTimeout(() => {
      if (!found) fail(`${provider} did not print an HTTPS URL in time.`);
    }, URL_WATCH_MS);
  });
}

async function main() {
  console.log(`[tunnel] Forwarding local port ${PORT} to a public HTTPS origin…`);
  const attempts = [
    {
      provider: "cloudflare",
      ...npxInvocation(["--yes", "cloudflared", "tunnel", "--url", `http://127.0.0.1:${PORT}`]),
    },
    {
      provider: "localtunnel",
      ...npxInvocation(["--yes", "localtunnel", "--port", PORT]),
    },
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[tunnel] Trying ${attempt.provider}…`);
      const child = start(attempt.command, attempt.args);
      await watch(child, attempt.provider);
      const stop = () => {
        terminateTree(child);
        clear();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      child.on("exit", () => {
        clear();
        process.exit(0);
      });
      return;
    } catch (cause) {
      console.warn(`[tunnel] ${attempt.provider} failed:`, cause instanceof Error ? cause.message : cause);
    }
  }

  clear();
  console.error("[tunnel] Could not start a free HTTPS tunnel. Check that npm run dev is running on port 3000.");
  process.exit(1);
}

void main();
