import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOUSEKEEPING_PROOF_RATE_WINDOW_MS,
  hashHousekeepingProofToken,
  housekeepingProofAdminClient,
  housekeepingProofJson,
  housekeepingProofRateLimited,
  parseHousekeepingProofTokenBody,
  type HousekeepingProofError,
  type HousekeepingProofRateMap,
} from "@/lib/housekeeping-proof";
import { housekeepingProofNow } from "@/lib/housekeeping-proof-clock";

/** Server-only. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("housekeeping-proof-submit is server-only");
}

export const HOUSEKEEPING_PROOF_SUBMIT_RPC = "submit_housekeeping_proof_atomic";
export const HOUSEKEEPING_PROOF_SUBMIT_PATH = "/api/housekeeping/proof/submit";
export const HOUSEKEEPING_PROOF_SUBMIT_RATE_MAX = 20;
export const HOUSEKEEPING_PROOF_SUBMIT_SUCCESS_KEYS = ["ok", "status", "idempotent"] as const;

const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;

const ipRateHits: HousekeepingProofRateMap = new Map();
const hashRateHits: HousekeepingProofRateMap = new Map();

export type HousekeepingProofSubmitResult = {
  status: "submitted";
  idempotent: boolean;
};

export type HousekeepingProofSubmitStore = {
  findTokenByHash(tokenHash: string): Promise<{ task_id: string; expires_at: string; revoked_at: string | null } | null>;
  submitAtomic(tokenHash: string): Promise<HousekeepingProofSubmitResult>;
};

export class HousekeepingProofSubmitRpcError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("unavailable");
    this.name = "HousekeepingProofSubmitRpcError";
    this.code = code;
  }
}

function err(status: number, error: HousekeepingProofError) {
  return { status, body: { error } as Record<string, unknown> };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function housekeepingProofSubmitIpRateKey(ip: string) {
  return `submit:ip:${ip}`;
}

export function housekeepingProofSubmitHashRateKey(tokenHash: string) {
  return `submit:hash:${tokenHash}`;
}

export function mapHousekeepingProofSubmitRpcCode(code: string | undefined): { status: number; body: Record<string, unknown> } {
  if (code === "ZP002") return err(404, "invalid");
  if (code === "ZP003") return err(409, "unavailable");
  if (code === "ZP004") return err(410, "expired");
  if (code === "ZP005") return err(410, "revoked");
  return err(503, "unavailable");
}

function parseHousekeepingProofSubmitRpcResult(data: unknown): HousekeepingProofSubmitResult | null {
  let row: unknown = data;
  if (Array.isArray(data)) {
    if (data.length !== 1) return null;
    row = data[0];
  }
  if (!isPlainObject(row)) return null;
  if (row.status !== "submitted") return null;
  if (typeof row.idempotent !== "boolean") return null;
  return { status: "submitted", idempotent: row.idempotent };
}

export async function handleHousekeepingProofSubmit(input: {
  body: unknown;
  ip: string;
  now?: Date;
  nodeEnv?: string;
  timeZone?: string;
  store?: HousekeepingProofSubmitStore;
  getStore?: () => HousekeepingProofSubmitStore | null;
  ipRateMap?: HousekeepingProofRateMap;
  hashRateMap?: HousekeepingProofRateMap;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = parseHousekeepingProofTokenBody(input.body);
  if ("error" in parsed) return err(400, parsed.error);

  const tokenHash = hashHousekeepingProofToken(parsed.token);
  const ipKey = housekeepingProofSubmitIpRateKey(input.ip || "local");
  const hashKey = housekeepingProofSubmitHashRateKey(tokenHash);
  if (
    housekeepingProofRateLimited(
      input.ipRateMap ?? ipRateHits,
      ipKey,
      HOUSEKEEPING_PROOF_SUBMIT_RATE_MAX,
      HOUSEKEEPING_PROOF_RATE_WINDOW_MS,
    ) ||
    housekeepingProofRateLimited(
      input.hashRateMap ?? hashRateHits,
      hashKey,
      HOUSEKEEPING_PROOF_SUBMIT_RATE_MAX,
      HOUSEKEEPING_PROOF_RATE_WINDOW_MS,
    )
  ) {
    return err(429, "unavailable");
  }

  const store = input.store ?? input.getStore?.() ?? null;
  if (!store) return err(503, "unavailable");

  let tokenRow;
  try {
    tokenRow = await store.findTokenByHash(tokenHash);
  } catch {
    return err(503, "unavailable");
  }
  if (!tokenRow) return err(404, "invalid");
  if (tokenRow.revoked_at) return err(410, "revoked");

  const now =
    input.now ??
    housekeepingProofNow({
      nodeEnv: input.nodeEnv,
      timeZone: input.timeZone,
    });
  if (Number.isNaN(Date.parse(tokenRow.expires_at)) || new Date(tokenRow.expires_at).getTime() <= now.getTime()) {
    return err(410, "expired");
  }

  try {
    const result = await store.submitAtomic(tokenHash);
    if (result.status !== "submitted" || typeof result.idempotent !== "boolean") {
      return err(503, "unavailable");
    }
    return {
      status: 200,
      body: {
        ok: true,
        status: "submitted",
        idempotent: result.idempotent,
      },
    };
  } catch (error) {
    const code = error instanceof HousekeepingProofSubmitRpcError ? error.code : undefined;
    return mapHousekeepingProofSubmitRpcCode(code);
  }
}

export type MemoryHousekeepingProofSubmitRows = {
  tokens?: Array<{
    token_hash: string;
    task_id: string;
    expires_at: string;
    revoked_at: string | null;
  }>;
  tasks?: Array<{
    id: string;
    status: string;
    submitted_at?: string | null;
    updated_at?: string | null;
  }>;
  photos?: Array<{ task_id: string; review_status?: "pending" | "approved" | "rejected" }>;
  failFind?: boolean;
  failRpcCode?: string;
};

export function createMemoryHousekeepingProofSubmitStore(rows: MemoryHousekeepingProofSubmitRows = {}) {
  const tokens = [...(rows.tokens ?? [])];
  const tasks = (rows.tasks ?? []).map((row) => ({ ...row }));
  const photos = [...(rows.photos ?? [])];
  let writeCount = 0;

  const store: HousekeepingProofSubmitStore & {
    tasks: typeof tasks;
    writeCount: () => number;
  } = {
    tasks,
    writeCount: () => writeCount,
    async findTokenByHash(tokenHash) {
      if (rows.failFind) throw new Error("unavailable");
      const row = tokens.find((item) => item.token_hash === tokenHash);
      if (!row) return null;
      return { task_id: row.task_id, expires_at: row.expires_at, revoked_at: row.revoked_at };
    },
    async submitAtomic(tokenHash) {
      if (rows.failRpcCode) throw new HousekeepingProofSubmitRpcError(rows.failRpcCode);
      if (!TOKEN_HASH_RE.test(tokenHash)) throw new HousekeepingProofSubmitRpcError("ZP001");

      const token = tokens.find((item) => item.token_hash === tokenHash);
      if (!token) throw new HousekeepingProofSubmitRpcError("ZP002");
      if (token.revoked_at) throw new HousekeepingProofSubmitRpcError("ZP005");
      const nowMs = Date.now();
      if (Number.isNaN(Date.parse(token.expires_at)) || new Date(token.expires_at).getTime() <= nowMs) {
        throw new HousekeepingProofSubmitRpcError("ZP004");
      }

      const task = tasks.find((row) => row.id === token.task_id);
      if (!task) throw new HousekeepingProofSubmitRpcError("ZP002");

      if (task.status === "submitted") {
        return { status: "submitted", idempotent: true };
      }
      if (task.status === "approved" || task.status === "closed") {
        throw new HousekeepingProofSubmitRpcError("ZP003");
      }
      if (task.status !== "open" && task.status !== "needs_attention") {
        throw new HousekeepingProofSubmitRpcError("ZP003");
      }

      const pending = photos.filter(
        (row) => row.task_id === task.id && (row.review_status ?? "pending") === "pending",
      ).length;
      if (pending < 1) throw new HousekeepingProofSubmitRpcError("ZP003");

      const nowIso = new Date(nowMs).toISOString();
      task.status = "submitted";
      task.submitted_at = nowIso;
      task.updated_at = nowIso;
      writeCount += 1;
      return { status: "submitted", idempotent: false };
    },
  };

  return store;
}

export function createSupabaseHousekeepingProofSubmitStore(admin: SupabaseClient): HousekeepingProofSubmitStore {
  return {
    async findTokenByHash(tokenHash) {
      const { data, error } = await admin
        .from("housekeeping_proof_tokens")
        .select("task_id, expires_at, revoked_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      const taskId = typeof row.task_id === "string" ? row.task_id : "";
      const expiresAt = typeof row.expires_at === "string" ? row.expires_at : "";
      if (!taskId || !expiresAt) return null;
      return {
        task_id: taskId,
        expires_at: expiresAt,
        revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null,
      };
    },
    async submitAtomic(tokenHash) {
      const { data, error } = await admin.rpc(HOUSEKEEPING_PROOF_SUBMIT_RPC, {
        p_token_hash: tokenHash,
      });
      if (error) {
        const code = typeof error.code === "string" && error.code ? error.code : "unknown";
        throw new HousekeepingProofSubmitRpcError(code);
      }
      const parsed = parseHousekeepingProofSubmitRpcResult(data);
      if (!parsed) throw new HousekeepingProofSubmitRpcError("unknown");
      return parsed;
    },
  };
}

export function housekeepingProofSubmitAdminClient() {
  return housekeepingProofAdminClient();
}

export { housekeepingProofJson };
