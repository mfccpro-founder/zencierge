/**
 * Free public HTTPS tunnel to this machine's Next.js HTTP server (port 3000).
 * Keep `npm run dev` running. Phones open the printed HTTPS URL for Tap to talk.
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
  console.log(`[tunnel] HTTPS for phones: ${origin.replace(/\/$/, "")}`);
  console.log("[tunnel] Keep this window open. Refresh the guest QR card, then scan on your phone.");
  console.log("[tunnel] Local http://localhost and LAN IPs are unchanged.");
  console.log("");
}

function clear() {
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function start(command, args) {
  return spawn(command, args, { cwd: root, shell: true, stdio: ["ignore", "pipe", "pipe"] });
}

function watch(child, provider) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let found = "";
    const succeed = () => {
      if (settled || !found) return;
      settled = true;
      resolve({ child, found });
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(message));
    };
    const onChunk = (buf) => {
      const text = buf.toString();
      process.stdout.write(text);
      const match = text.match(URL_RE);
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
    setTimeout(() => {
      if (found) succeed();
    }, 6000);
    setTimeout(() => {
      if (!found) fail(`${provider} did not print an HTTPS URL in time.`);
    }, 28000);
  });
}

async function main() {
  console.log(`[tunnel] Forwarding http://127.0.0.1:${PORT} to a public HTTPS URL…`);
  const attempts = [
    {
      provider: "cloudflare",
      command: "npx",
      args: ["--yes", "cloudflared", "tunnel", "--url", `http://127.0.0.1:${PORT}`],
    },
    {
      provider: "localtunnel",
      command: "npx",
      args: ["--yes", "localtunnel", "--port", PORT],
    },
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[tunnel] Trying ${attempt.provider}…`);
      const child = start(attempt.command, attempt.args);
      await watch(child, attempt.provider);
      const stop = () => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
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
