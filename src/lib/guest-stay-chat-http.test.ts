import { NextRequest } from "next/server";
import { handleGuestStayChatHttp } from "@/app/api/guest/stay-chat/route";
import { createMemoryStayTokenStore, generateStayToken, hashStayToken } from "./guest-stay-token";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const property = { id: "property-a", name: "A", city: "Miami Beach", timezone: "UTC" };
const reservation = {
  id: "reservation-a", property_id: property.id, check_in: "2026-10-01", check_in_time: "15:00",
  check_out: "2099-10-20", check_out_time: "11:00", status: "staying",
};
const token = generateStayToken();
const store = createMemoryStayTokenStore({
  properties: [property], reservations: [reservation], tokens: [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", token_hash: hashStayToken(token),
    reservation_id: reservation.id, property_id: property.id,
    expires_at: "2099-10-20T11:00:00.000Z", revoked_at: null,
    created_at: "2026-10-01T00:00:00.000Z", created_by: null,
  }],
});

async function post(body: unknown, ip: string) {
  const request = new NextRequest("http://localhost/api/guest/stay-chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  const response = await handleGuestStayChatHttp(request, store);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const valid = await post({ token, message: "When is checkout?" }, "127.0.0.11");
assert(valid.status === 200 && typeof valid.body.reply === "string", "valid stay token reaches guest chat without host session");

const absent = await post({ message: "Hello" }, "127.0.0.12");
assert(absent.status === 400 && absent.body.error === "invalid", "missing token is rejected");

const invalid = await post({ token: generateStayToken(), message: "Hello" }, "127.0.0.13");
assert(invalid.status === 404 && invalid.body.error === "invalid", "unknown token is rejected");

const expiredToken = generateStayToken();
store.tokens.push({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", token_hash: hashStayToken(expiredToken),
  reservation_id: reservation.id, property_id: property.id,
  expires_at: "2020-01-01T00:00:00.000Z", revoked_at: null,
  created_at: "2019-01-01T00:00:00.000Z", created_by: null,
});
const expired = await post({ token: expiredToken, message: "Hello" }, "127.0.0.14");
assert(expired.status === 410 && expired.body.error === "expired", "expired token is rejected");

console.log("guest stay chat HTTP tests passed");
