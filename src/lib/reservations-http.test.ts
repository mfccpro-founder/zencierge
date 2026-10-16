import type { SupabaseClient } from "@supabase/supabase-js";
import { handleReservationPost } from "@/app/api/reservations/route";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const reservation = {
  id: "reservation-a", propertyId: "property-a", guest: "Guest", phone: "",
  platform: "Direct", checkIn: "2026-10-14", checkOut: "2026-10-15",
  checkInTime: "15:00", checkOutTime: "11:00", accessCode: "", aiNotes: "",
  nights: 1, status: "upcoming",
};

async function invoke(code?: string) {
  let args: Record<string, unknown> | undefined;
  const admin = {
    async rpc(name: string, supplied: Record<string, unknown>) {
      assert(name === "save_host_reservation", "HTTP route uses protected reservation RPC");
      args = supplied;
      return { error: code ? { code } : null };
    },
  } as unknown as SupabaseClient;
  const response = await handleReservationPost(new Request("http://localhost/api/reservations", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reservation),
  }), { hostId: "11111111-1111-4111-8111-111111111111", admin });
  return { response, body: await response.json() as Record<string, unknown>, args };
}

const success = await invoke();
assert(success.response.status === 200 && success.body.ok === true, "authorized host save succeeds");
assert(success.args?.p_host_id === "11111111-1111-4111-8111-111111111111", "host id comes from authenticated server context");

const foreignProperty = await invoke("ZR002");
assert(foreignProperty.response.status === 403, "property not owned by host is forbidden");

const foreignId = await invoke("ZR001");
assert(foreignId.response.status === 409, "foreign reservation id collision is a conflict");

console.log("reservations HTTP tests passed");
