import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateStayToken, hashStayToken, createMemoryStayTokenStore } from "./guest-stay-token";
import { handleGuestStayChat } from "./guest-stay-chat";
import { isTwoTowelsRequest, updateHostServiceRequest, type GuestServiceRequestStatus, type GuestServiceRequestStore } from "./guest-service-requests";
import { createMemoryHostOwnershipStore } from "./host-property-ownership";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export async function runGuestServiceRequestTests() {
  assert(isTwoTowelsRequest("Could we get two extra towels?"), "English request detected");
  assert(isTwoTowelsRequest("Necesito dos toallas"), "Spanish request detected");
  assert(!isTwoTowelsRequest("Where are the towels?"), "non-request is not persisted");

  const raw = generateStayToken();
  const other = generateStayToken();
  const tokens = createMemoryStayTokenStore({
    properties: [
      { id: "prop-a", name: "A", city: "Miami", timezone: "UTC" },
      { id: "prop-b", name: "B", city: "Miami", timezone: "UTC" },
    ],
    reservations: [
      { id: "res-a", property_id: "prop-a", check_in: "2026-01-01", check_in_time: "", check_out: "2099-01-01", check_out_time: "", status: "staying" },
      { id: "res-b", property_id: "prop-b", check_in: "2026-01-01", check_in_time: "", check_out: "2099-01-01", check_out_time: "", status: "staying" },
    ],
    tokens: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", token_hash: hashStayToken(raw), reservation_id: "res-a", property_id: "prop-a", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, created_at: "2026-01-01T00:00:00Z", created_by: null },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", token_hash: hashStayToken(other), reservation_id: "res-b", property_id: "prop-b", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, created_at: "2026-01-01T00:00:00Z", created_by: null },
    ],
  });
  const writes: string[] = [];
  const requestStore = { createTowelRequest: async ({ token }) => { writes.push(`${token.reservation_id}:${token.property_id}`); return { id: "req", status: "requested" }; } } as GuestServiceRequestStore;
  const success = await handleGuestStayChat({ body: { token: raw, message: "Please send two towels" }, store: tokens, requestStore });
  assert(success.status === 200 && String(success.body.reply).includes("registered"), "confirmation follows successful persistence");
  assert(writes.join() === "res-a:prop-a", "write uses authorized stay scope");
  const invalid = await handleGuestStayChat({ body: { token: generateStayToken(), message: "Please send two towels" }, store: tokens, requestStore });
  assert(invalid.status === 404 && writes.length === 1, "invalid token rejected without write");
  const otherSuccess = await handleGuestStayChat({ body: { token: other, message: "Please send two towels" }, store: tokens, requestStore });
  assert(otherSuccess.status === 200 && writes[1] === "res-b:prop-b", "stays remain isolated");
  const failedStore = { ...requestStore, createTowelRequest: async () => { throw new Error("db"); } };
  let failed = false;
  try { await handleGuestStayChat({ body: { token: raw, message: "Please send two towels" }, store: tokens, requestStore: failedStore }); } catch { failed = true; }
  assert(failed, "persistence failure never returns confirmation");

  const requestRow: Record<string, unknown> = { id: "11111111-1111-4111-8111-111111111111", property_id: "prop-a", reservation_id: "res-a", request_type: "extra_towels", quantity: 2, status: "requested", assigned_to: null, proof_task_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
  const hostStore = {
    ...requestStore,
    listForProperties: async () => [requestRow], getById: async () => requestRow,
    updateStatus: async (_id: string, _expectedStatus: GuestServiceRequestStatus, patch: Record<string, unknown>) => Object.assign(requestRow, patch),
    linkProofForReservation: async () => undefined, markByProofTask: async () => undefined,
  } as GuestServiceRequestStore;
  const ownership = createMemoryHostOwnershipStore({ properties: { "prop-a": { hostId: "11111111-1111-4111-8111-111111111111" } }, reservations: { "res-a": { propertyId: "prop-a" } } });
  const wrongHost = await updateHostServiceRequest({ id: String(requestRow.id), nextStatus: "assigned", auth: { userId: "22222222-2222-4222-8222-222222222222", source: "supabase-auth" }, ownershipStore: ownership, store: hostStore });
  assert(wrongHost.status === 403 && requestRow.status === "requested", "other host cannot assign request");
  const owner = await updateHostServiceRequest({ id: String(requestRow.id), nextStatus: "assigned", auth: { userId: "11111111-1111-4111-8111-111111111111", source: "supabase-auth" }, ownershipStore: ownership, store: hostStore });
  assert(owner.status === 200 && String(requestRow.status) === "assigned" && requestRow.assigned_to === "Demo Housekeeping", "owner assigns Demo Housekeeping");

  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261014143000_guest_service_requests.sql"), "utf8");
  assert(sql.includes("force row level security"), "FORCE RLS enabled");
  assert(sql.includes("revoke all on table public.guest_service_requests from anon"), "anon revoked");
  assert(sql.includes("revoke all on table public.guest_service_requests from authenticated"), "authenticated revoked");
  assert(sql.includes("grant execute on function public.create_guest_towel_request_atomic(uuid, text, text) to service_role"), "RPC service-role only");
}

if (process.argv[1]?.includes("guest-service-requests.test")) {
  runGuestServiceRequestTests().then(() => console.log("guest service request tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
}
