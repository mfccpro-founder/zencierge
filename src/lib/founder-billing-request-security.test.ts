import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateFounderBillingMutationRequest } from "./founder-billing-request-security";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function check(input: {
  requestUrl?: string;
  origin?: string | null;
  contentType?: string | null;
  secFetchSite?: string | null;
}) {
  return validateFounderBillingMutationRequest({
    requestUrl:
      input.requestUrl ??
      "https://app.zencierge.com/api/backoffice/customers/user-1/complimentary",
    origin:
      input.origin === undefined
        ? "https://app.zencierge.com"
        : input.origin,
    contentType:
      input.contentType === undefined
        ? "application/json"
        : input.contentType,
    secFetchSite:
      input.secFetchSite === undefined
        ? "same-origin"
        : input.secFetchSite,
  });
}

function runFounderBillingRequestSecurityTests() {
  assert(check({}).ok, "exact HTTPS origin is allowed");
  assert(
    check({
      requestUrl:
        "http://localhost:3000/api/backoffice/customers/u/complimentary",
      origin: "http://localhost:3000",
    }).ok,
    "exact localhost origin is allowed",
  );
  assert(
    check({
      requestUrl:
        "http://192.168.1.20:3000/api/backoffice/customers/u/complimentary",
      origin: "http://192.168.1.20:3000",
    }).ok,
    "exact LAN origin is allowed",
  );

  for (const [label, origin] of [
    ["missing", null],
    ["empty", ""],
    ["null literal", "null"],
    ["malformed", "not an origin"],
    ["cross origin", "https://evil.example"],
    ["protocol mismatch", "http://app.zencierge.com"],
    ["host mismatch", "https://admin.zencierge.com"],
    ["port mismatch", "https://app.zencierge.com:444"],
    ["prefix trick", "https://app.zencierge.com.evil.example"],
  ] as const) {
    const result = check({ origin });
    assert(
      !result.ok && result.status === 403,
      `${label} Origin is forbidden`,
    );
  }

  assert(
    check({
      origin: "https://app.zencierge.com/path?query=1",
    }).ok,
    "Origin parsing compares normalized origin only",
  );

  for (const contentType of [
    "application/json",
    "application/json; charset=utf-8",
    "Application/JSON; Charset=UTF-8",
  ]) {
    assert(
      check({ contentType }).ok,
      `${contentType} is accepted`,
    );
  }

  for (const [label, contentType] of [
    ["missing", null],
    ["plain text", "text/plain"],
    ["form", "application/x-www-form-urlencoded"],
    ["multipart", "multipart/form-data; boundary=test"],
    ["suffix JSON", "application/problem+json"],
  ] as const) {
    const result = check({ contentType });
    assert(
      !result.ok && result.status === 415,
      `${label} content type is rejected`,
    );
  }

  assert(
    check({ secFetchSite: "same-origin" }).ok,
    "same-origin Fetch Metadata is allowed",
  );
  assert(
    check({ secFetchSite: null }).ok,
    "missing Fetch Metadata relies on mandatory Origin",
  );

  for (const secFetchSite of [
    "cross-site",
    "same-site",
    "none",
    "",
    "unknown",
  ]) {
    const result = check({ secFetchSite });
    assert(
      !result.ok && result.status === 403,
      `${secFetchSite || "empty"} Fetch Metadata is forbidden`,
    );
  }

  const route = readFileSync(
    join(
      process.cwd(),
      "src/app/api/backoffice/customers/[id]/complimentary/route.ts",
    ),
    "utf8",
  );
  const securityGateAt = route.indexOf(
    "const requestSecurity = validateFounderBillingMutationRequest",
  );
  const parseBodyAt = route.indexOf("request.json()");
  const mutationAt = route.indexOf(
    "const result = await applyComplimentaryAccess",
  );
  const postAt = route.indexOf("export async function POST");
  const getAt = route.indexOf("export async function GET");

  assert(
    securityGateAt > postAt,
    "mutation request gate is inside POST",
  );
  assert(
    securityGateAt > getAt && getAt < postAt,
    "GET remains outside the mutation request gate",
  );
  assert(
    securityGateAt < parseBodyAt,
    "request gate runs before JSON parsing",
  );
  assert(
    securityGateAt < mutationAt,
    "request gate runs before complimentary mutation",
  );
  assert(
    route.includes("isFounderBillingOperator"),
    "strict Founder Billing authorization remains",
  );
  assert(
    !route.includes("SquareClient") &&
      !route.includes("createSquareClient"),
    "request-security microblock adds no Square SDK calls",
  );

  console.log("founder billing request security tests passed");
}

runFounderBillingRequestSecurityTests();