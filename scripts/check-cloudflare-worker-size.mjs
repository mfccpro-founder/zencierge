import { readFile } from "node:fs/promises";

const FREE_LIMIT_KIB = 64 * 1024;
const reportPath = process.argv[2];
if (!reportPath) throw new Error("Usage: node scripts/check-cloudflare-worker-size.mjs <wrangler-output.txt>");

const output = await readFile(reportPath, "utf8");
const match = output.match(/Total Upload:\s*([\d.]+)\s*(KiB|MiB)/i);
if (!match) throw new Error("Wrangler did not report an uncompressed Total Upload size; compatibility is unverified.");

const uploadKiB = Number(match[1]) * (match[2].toLowerCase() === "mib" ? 1024 : 1);
if (!Number.isFinite(uploadKiB)) throw new Error("Wrangler reported an invalid Total Upload size.");
console.log(JSON.stringify({ uncompressedUploadKiB: uploadKiB, workersFreeLimitKiB: FREE_LIMIT_KIB }));
if (uploadKiB > FREE_LIMIT_KIB) {
  throw new Error(`Uncompressed Worker upload is ${uploadKiB} KiB, above the Workers Free limit of ${FREE_LIMIT_KIB} KiB.`);
}
