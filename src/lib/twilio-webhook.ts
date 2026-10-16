import { createHmac, timingSafeEqual } from "node:crypto";

export function validateTwilioFormSignature(input: {
  authToken: string;
  signature: string;
  url: string;
  params: URLSearchParams;
}) {
  if (!input.authToken || !input.signature || !input.url) return false;
  const names = [...new Set(input.params.keys())].sort();
  let signed = input.url;
  for (const name of names) {
    for (const value of input.params.getAll(name).sort()) signed += `${name}${value}`;
  }
  const expected = createHmac("sha1", input.authToken).update(signed, "utf8").digest("base64");
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
