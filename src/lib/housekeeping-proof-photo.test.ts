import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { generateHousekeepingProofToken, hashHousekeepingProofToken } from "./housekeeping-proof";
import {
  HOUSEKEEPING_PROOF_MULTIPART_MAX_BYTES,
  HOUSEKEEPING_PROOF_PHOTO_BUCKET,
  HOUSEKEEPING_PROOF_PHOTO_CONTENT_TYPE,
  HOUSEKEEPING_PROOF_PHOTO_INSERT_COLUMNS,
  HOUSEKEEPING_PROOF_PHOTO_MAX_BYTES,
  HOUSEKEEPING_PROOF_PHOTO_MAX_EDGE,
  HOUSEKEEPING_PROOF_PHOTO_MAX_PER_TASK,
  HOUSEKEEPING_PROOF_PHOTO_MAX_PIXELS,
  HOUSEKEEPING_PROOF_UPLOAD_RATE_MAX,
  HOUSEKEEPING_PROOF_UPLOAD_TASK_COLUMNS,
  createMemoryHousekeepingProofPhotoStore,
  handleHousekeepingProofPhotoUpload,
  housekeepingProofUploadContentLengthRejected,
  housekeepingProofUploadHashRateKey,
  housekeepingProofUploadIpRateKey,
  isHousekeepingProofPhotoPath,
  normalizeHousekeepingProofPhoto,
  parseHousekeepingProofUploadForm,
} from "./housekeeping-proof-photo";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const TASK_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = new Date("2026-09-03T16:00:00.000Z");

async function imageBytes(format: "jpeg" | "png" | "webp", width = 64, height = 48) {
  const pipeline = sharp({ create: { width, height, channels: 3, background: { r: 20, g: 80, b: 140 } } });
  if (format === "png") return pipeline.png().toBuffer();
  if (format === "webp") return pipeline.webp().toBuffer();
  return pipeline.jpeg().toBuffer();
}

function uploadForm(token: string, bytes: Buffer, type = "application/octet-stream", extra?: (form: FormData) => void) {
  const form = new FormData();
  form.set("token", token);
  form.set("photo", new File([new Uint8Array(bytes)], "upload.bin", { type }));
  extra?.(form);
  return form;
}

function seed(status: string, extras?: { revoked?: boolean; expired?: boolean; count?: number; failInsert?: boolean }) {
  const token = generateHousekeepingProofToken();
  const store = createMemoryHousekeepingProofPhotoStore({
    tokens: [
      {
        token_hash: hashHousekeepingProofToken(token),
        task_id: TASK_ID,
        expires_at: extras?.expired ? "2026-01-01T00:00:00.000Z" : "2026-12-01T00:00:00.000Z",
        revoked_at: extras?.revoked ? "2026-09-01T00:00:00.000Z" : null,
      },
    ],
    tasks: [{ id: TASK_ID, status }],
    photoCount: { [TASK_ID]: extras?.count ?? 0 },
    failInsert: extras?.failInsert,
  });
  return { token, store };
}

async function upload(status: string, bytes: Buffer, extras?: Parameters<typeof seed>[1] & { type?: string; ip?: string; ipMap?: Map<string, number[]>; hashMap?: Map<string, number[]> }) {
  const { token, store } = seed(status, extras);
  const form = uploadForm(token, bytes, extras?.type);
  const result = await handleHousekeepingProofPhotoUpload({
    contentLength: "4096",
    readFormData: async () => form,
    ip: extras?.ip ?? "203.0.113.10",
    now: NOW,
    store,
    ipRateMap: extras?.ipMap ?? new Map(),
    hashRateMap: extras?.hashMap ?? new Map(),
  });
  return { result, store, token };
}

export async function runHousekeepingProofPhotoTests() {
  const here = dirname(fileURLToPath(import.meta.url));
  const photoSrc = readFileSync(join(here, "housekeeping-proof-photo.ts"), "utf8");
  const routeSrc = readFileSync(join(here, "../app/api/housekeeping/proof/upload/route.ts"), "utf8");
  const proofSrc = readFileSync(join(here, "housekeeping-proof.ts"), "utf8");
  const validateRouteSrc = readFileSync(join(here, "../app/api/housekeeping/proof/route.ts"), "utf8");
  const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8")) as { dependencies?: Record<string, string> };

  assert(pkg.dependencies?.sharp === "0.35.4", "sharp is a direct production dependency at the lockfile version");
  assert(HOUSEKEEPING_PROOF_PHOTO_BUCKET === "housekeeping-proof", "private proof bucket");
  assert(HOUSEKEEPING_PROOF_PHOTO_MAX_PER_TASK === 8, "application-level photo cap is 8");
  assert(photoSrc.includes("Application-level cap only"), "cap is documented as not a database concurrency guarantee");
  assert(HOUSEKEEPING_PROOF_PHOTO_MAX_PIXELS === 20_000_000, "pixel cap");
  assert(HOUSEKEEPING_PROOF_UPLOAD_TASK_COLUMNS === "id, status", "upload task select is id and status only");
  assert(HOUSEKEEPING_PROOF_PHOTO_INSERT_COLUMNS.join(",") === "task_id,storage_path,content_type,byte_size,width,height", "insert columns");

  assert(housekeepingProofUploadContentLengthRejected(null), "missing Content-Length rejected");
  assert(housekeepingProofUploadContentLengthRejected("0"), "zero Content-Length rejected");
  assert(housekeepingProofUploadContentLengthRejected("nope"), "invalid Content-Length rejected");
  assert(housekeepingProofUploadContentLengthRejected(String(HOUSEKEEPING_PROOF_MULTIPART_MAX_BYTES + 1)), "excessive Content-Length rejected");
  assert(!housekeepingProofUploadContentLengthRejected("4096"), "valid Content-Length accepted");

  let formCalled = false;
  const skipped = await handleHousekeepingProofPhotoUpload({
    contentLength: null,
    readFormData: async () => {
      formCalled = true;
      return new FormData();
    },
    ip: "203.0.113.10",
    store: createMemoryHousekeepingProofPhotoStore(),
  });
  assert(skipped.status === 400 && !formCalled, "formData is not parsed without a valid Content-Length");

  const token = generateHousekeepingProofToken();
  const jpeg = await imageBytes("jpeg");
  const parsedOk = parseHousekeepingProofUploadForm(uploadForm(token, jpeg));
  assert(!("error" in parsedOk), "token and photo allowlist accepted");
  const extra = uploadForm(token, jpeg, "image/jpeg", (form) => form.set("extra", "1"));
  assert("error" in parseHousekeepingProofUploadForm(extra), "extra field rejected");
  const dup = new FormData();
  dup.append("token", token);
  dup.append("token", token);
  dup.set("photo", new File([new Uint8Array(jpeg)], "p.jpg", { type: "image/jpeg" }));
  assert("error" in parseHousekeepingProofUploadForm(dup), "duplicate token rejected");
  const missing = new FormData();
  missing.set("token", token);
  assert("error" in parseHousekeepingProofUploadForm(missing), "missing photo rejected");
  assert("error" in parseHousekeepingProofUploadForm(uploadForm(token, Buffer.alloc(0))), "empty file rejected");
  assert(
    "error" in parseHousekeepingProofUploadForm(uploadForm(token, Buffer.alloc(HOUSEKEEPING_PROOF_PHOTO_MAX_BYTES + 1))),
    "oversized file rejected",
  );

  const png = await imageBytes("png");
  const webp = await imageBytes("webp");
  const openJpeg = await upload("open", jpeg, { type: "image/gif" });
  assert(openJpeg.result.status === 200 && openJpeg.result.body.ok === true, "open task can upload");
  assert(Object.keys(openJpeg.result.body).join(",") === "ok", "success body is ok only");
  assert(!("path" in openJpeg.result.body) && !("id" in openJpeg.result.body), "no path or id in success");
  assert(openJpeg.store.uploaded.length === 1 && openJpeg.store.uploaded[0]?.upsert === false, "upsert false");
  assert(openJpeg.store.uploaded[0]?.contentType === HOUSEKEEPING_PROOF_PHOTO_CONTENT_TYPE, "stored jpeg content type");
  assert(isHousekeepingProofPhotoPath(openJpeg.store.uploaded[0]?.path ?? ""), "UUID-only proof path");
  assert(!openJpeg.store.uploaded[0]?.path.includes(openJpeg.token), "path has no token");
  assert(!openJpeg.store.uploaded[0]?.path.includes(hashHousekeepingProofToken(openJpeg.token)), "path has no hash");
  assert(!openJpeg.store.uploaded[0]?.path.includes(TASK_ID), "path has no task id");
  const insert = openJpeg.store.inserts[0];
  assert(insert?.task_id === TASK_ID, "insert task_id");
  assert(insert?.content_type === "image/jpeg", "insert content_type");
  assert(insert && insert.byte_size > 0 && insert.width > 0 && insert.height > 0, "insert size and dimensions");
  assert(Object.keys(insert ?? {}).sort().join(",") === "byte_size,content_type,height,storage_path,task_id,width", "exact insert keys");

  const attention = await upload("needs_attention", png);
  assert(attention.result.status === 200, "needs_attention can upload");
  const pngOut = await sharp(attention.store.uploaded[0]!.bytes).metadata();
  assert(pngOut.format === "jpeg", "png is re-encoded to jpeg");

  const webpUp = await upload("open", webp);
  assert(webpUp.result.status === 200, "webp decodes");

  const submitted = await upload("submitted", jpeg);
  const approved = await upload("approved", jpeg);
  const closed = await upload("closed", jpeg);
  assert(submitted.result.status === 409 && submitted.store.uploaded.length === 0, "submitted cannot upload");
  assert(approved.store.uploaded.length === 0 && closed.store.uploaded.length === 0, "approved and closed cannot upload");

  const missingTok = await handleHousekeepingProofPhotoUpload({
    contentLength: "4096",
    readFormData: async () => uploadForm(generateHousekeepingProofToken(), jpeg),
    ip: "203.0.113.11",
    now: NOW,
    store: createMemoryHousekeepingProofPhotoStore(),
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(missingTok.status === 404 && missingTok.body.error === "invalid", "missing token row is invalid");

  const revoked = await upload("open", jpeg, { revoked: true });
  const expired = await upload("open", jpeg, { expired: true });
  assert(revoked.result.status === 410 && revoked.result.body.error === "revoked", "revoked");
  assert(expired.result.status === 410 && expired.result.body.error === "expired", "expired");
  assert(revoked.store.uploaded.length === 0 && expired.store.uploaded.length === 0, "revoked/expired do not upload");

  const heicSeed = seed("open");
  const heic = await handleHousekeepingProofPhotoUpload({
    contentLength: "4096",
    readFormData: async () => uploadForm(heicSeed.token, Buffer.from("ftypheic"), "image/heic"),
    ip: "203.0.113.12",
    now: NOW,
    store: heicSeed.store,
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(heic.status === 400 && heicSeed.store.uploaded.length === 0, "HEIC rejected");

  const svg = await upload("open", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>'), {
    type: "image/svg+xml",
  });
  const pdf = await upload("open", Buffer.from("%PDF-1.4\n"), { type: "application/pdf" });
  const html = await upload("open", Buffer.from("<html><body>x</body></html>"), { type: "text/html" });
  const unknown = await upload("open", Buffer.from("not-an-image"));
  assert(svg.result.status === 400 && pdf.result.status === 400 && html.result.status === 400, "svg/pdf/html rejected");
  assert(unknown.result.status === 400 && unknown.store.uploaded.length === 0, "unknown bytes rejected");

  const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).gif().toBuffer();
  const gifUp = await upload("open", gif, { type: "image/gif" });
  assert(gifUp.result.status === 400 && gifUp.store.uploaded.length === 0, "gif rejected");

  const decodeFailStore = createMemoryHousekeepingProofPhotoStore({
    tokens: seed("open").store && [],
  });
  const seeded = seed("open");
  const pixelFail = await handleHousekeepingProofPhotoUpload({
    contentLength: "4096",
    readFormData: async () => uploadForm(seeded.token, jpeg),
    ip: "203.0.113.13",
    now: NOW,
    store: seeded.store,
    ipRateMap: new Map(),
    hashRateMap: new Map(),
    normalize: async () => ({ error: "invalid" }),
  });
  assert(pixelFail.status === 400 && seeded.store.uploaded.length === 0, "decode/pixel failure never touches Storage");
  assert(photoSrc.includes("limitInputPixels: HOUSEKEEPING_PROOF_PHOTO_MAX_PIXELS"), "pixel limit is passed to sharp");
  void decodeFailStore;

  const wide = await imageBytes("jpeg", 3000, 1000);
  const resized = await normalizeHousekeepingProofPhoto(wide);
  assert(!("error" in resized), "wide jpeg normalizes");
  if (!("error" in resized)) {
    assert(resized.width <= HOUSEKEEPING_PROOF_PHOTO_MAX_EDGE && resized.height <= HOUSEKEEPING_PROOF_PHOTO_MAX_EDGE, "max edge 2048");
    const small = await imageBytes("jpeg", 40, 30);
    const unscaled = await normalizeHousekeepingProofPhoto(small);
    assert(!("error" in unscaled) && unscaled.width === 40 && unscaled.height === 30, "no upscale");
    const outMeta = await sharp(resized.buffer).metadata();
    assert(outMeta.format === "jpeg", "output is jpeg");
    assert((outMeta.width ?? 0) > 0 && (outMeta.height ?? 0) > 0, "positive output dimensions");
  }

  const tagged = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#334455" } })
    .withMetadata({
      exif: {
        IFD0: { Copyright: "secret-meta" },
        IFD3: { GPSLatitudeRef: "N" },
      },
    })
    .jpeg()
    .toBuffer();
  const before = await sharp(tagged).metadata();
  assert(Boolean(before.exif), "fixture has metadata before normalize");
  const stripped = await normalizeHousekeepingProofPhoto(tagged);
  assert(!("error" in stripped), "tagged jpeg normalizes");
  if (!("error" in stripped)) {
    const after = await sharp(stripped.buffer).metadata();
    assert(!after.exif, "EXIF removed after re-encode");
    assert(!/gps|copyright|secret-meta/i.test(JSON.stringify(after)), "GPS/metadata absent from output metadata");
    assert(!photoSrc.includes("withMetadata("), "pipeline never calls withMetadata");
  }

  const failDb = seed("open", { failInsert: true });
  const failResult = await handleHousekeepingProofPhotoUpload({
    contentLength: "4096",
    readFormData: async () => uploadForm(failDb.token, jpeg),
    ip: "203.0.113.14",
    now: NOW,
    store: failDb.store,
    ipRateMap: new Map(),
    hashRateMap: new Map(),
  });
  assert(failResult.status === 503 && failResult.body.error === "unavailable", "db failure is unavailable");
  assert(failDb.store.uploaded.length === 1 && failDb.store.removed[0] === failDb.store.uploaded[0]?.path, "db failure removes the uploaded object");
  assert(!JSON.stringify(failResult.body).includes(failDb.store.uploaded[0]?.path ?? "proof/"), "cleanup path is not exposed");

  const capped = await upload("open", jpeg, { count: HOUSEKEEPING_PROOF_PHOTO_MAX_PER_TASK });
  assert(capped.result.status === 409 && capped.result.body.error === "unavailable", "ninth sequential upload is unavailable");
  assert(capped.store.uploaded.length === 0, "ninth sequential upload does not call Storage");

  const ipMap = new Map<string, number[]>();
  const hashMap = new Map<string, number[]>();
  for (let i = 0; i < HOUSEKEEPING_PROOF_UPLOAD_RATE_MAX; i += 1) {
    const hit = await upload("open", jpeg, { ip: "198.51.100.8", ipMap, hashMap });
    assert(hit.result.status === 200, "upload under rate limit");
  }
  const limited = await upload("open", jpeg, { ip: "198.51.100.8", ipMap, hashMap });
  assert(limited.result.status === 429, "IP rate limited");
  const otherIp = await upload("open", jpeg, { ip: "198.51.100.9", ipMap, hashMap: new Map() });
  assert(otherIp.result.status === 200, "separate IP is not limited");
  assert(
    [...ipMap.keys(), ...hashMap.keys()].every(
      (key) => key.startsWith("upload:ip:") || key.startsWith("upload:hash:"),
    ),
    "rate keys are ip or hash",
  );
  assert(![...ipMap.keys(), ...hashMap.keys()].some((key) => key.includes(openJpeg.token)), "rate keys never use raw token");
  assert(housekeepingProofUploadIpRateKey("198.51.100.8").includes("198.51.100.8"), "ip rate key");
  assert(housekeepingProofUploadHashRateKey(hashHousekeepingProofToken(token)).includes("hash:"), "hash rate key");

  const validateReturn = proofSrc.slice(proofSrc.indexOf("return {\n    status: 200,\n    body: {"));
  assert(validateReturn.includes("propertyName") && !validateReturn.slice(0, 280).includes("task_id"), "public proof response has no task_id");
  assert(validateRouteSrc.includes("validateHousekeepingProofToken"), "validate route unchanged");

  const combined = `${photoSrc}\n${routeSrc}`;
  assert(routeSrc.includes("handleHousekeepingProofPhotoUpload"), "upload route uses isolated handler");
  assert(routeSrc.includes('runtime = "nodejs"'), "upload route is nodejs");
  assert(routeSrc.indexOf("contentLength") < routeSrc.indexOf("request.formData"), "Content-Length is supplied before formData");
  assert(photoSrc.indexOf("housekeepingProofUploadContentLengthRejected") < photoSrc.indexOf("readFormData"), "length bound runs before multipart parse");
  assert(!/\/housekeeping\/upload|HOUSEKEEPING_STORAGE_BUCKET/.test(combined), "no legacy upload route or public bucket helper");
  assert(!combined.includes("getPublicUrl") && !combined.includes("createSignedUrl"), "no public or signed URL");
  assert(!/createBrowserClient|createClient\(/.test(combined), "no browser Supabase client");
  assert(!/issueGuestStayLink|validateGuestStayToken|\/guest\/s\//.test(combined), "no guest-stay token/routes");
  assert(!/console\.(log|info|debug|error|warn)/.test(combined), "no console logging");
  assert(!combined.includes('select("*")') && !combined.includes("select('*')"), "no select star");
  assert(photoSrc.includes('from(HOUSEKEEPING_PROOF_PHOTO_BUCKET)'), "uploads go to housekeeping-proof");
  assert(photoSrc.includes("upsert: false"), "storage upsert is false");
  assert(photoSrc.includes('.rotate()') && photoSrc.includes(".flatten("), "auto-orient and flatten");
  assert(!photoSrc.includes("withMetadata("), "no withMetadata");
}

const isDirectRun = process.argv[1]?.includes("housekeeping-proof-photo.test");
if (isDirectRun) {
  runHousekeepingProofPhotoTests()
    .then(() => {
      console.log("housekeeping-proof-photo tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "housekeeping-proof-photo tests failed");
      process.exitCode = 1;
    });
}
