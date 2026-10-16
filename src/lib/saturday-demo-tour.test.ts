import {
  buildSaturdayDemoModules,
  fetchSaturdayDemoVerification,
  parseSaturdayDemoRequests,
  verifySaturdayDemoStep,
  type SaturdayDemoRequest,
} from "./saturday-demo-tour";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const request: SaturdayDemoRequest = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "requested",
  assignedTo: null,
  proofTaskId: null,
  createdAt: "2026-10-14T12:00:00.000Z",
};

export async function runSaturdayDemoTourTests() {
  const modules = buildSaturdayDemoModules("en");
  assert(modules.length === 7, "the Saturday story has seven presenter-controlled steps");
  assert(modules.map((row) => row.requirement).join(",") === "manual,manual,request_recorded,assigned,evidence_submitted,completed,manual", "operational gates are explicit");

  let result = verifySaturdayDemoStep("request_recorded", [request], null, "en");
  assert(result.ok && result.requestId === request.id, "the first verification tracks the server request id");
  result = verifySaturdayDemoStep("request_recorded", [request], null, "en", "2026-10-14T12:00:01.000Z");
  assert(!result.ok, "a request created before this demo run is never adopted");

  result = verifySaturdayDemoStep("assigned", [request], request.id, "en");
  assert(!result.ok, "a merely recorded request does not pass assignment");
  result = verifySaturdayDemoStep("assigned", [{ ...request, status: "assigned", assignedTo: "Demo Housekeeping" }], request.id, "en");
  assert(result.ok, "the assigned server state passes");

  result = verifySaturdayDemoStep("evidence_submitted", [{ ...request, status: "evidence_submitted", assignedTo: "Demo Housekeeping", proofTaskId: null }], request.id, "en");
  assert(!result.ok, "evidence status without a linked proof never passes");
  result = verifySaturdayDemoStep("completed", [{ ...request, status: "evidence_submitted", assignedTo: "Demo Housekeeping", proofTaskId: "proof-1" }], request.id, "en");
  assert(!result.ok, "submitted evidence is not presented as approval");
  result = verifySaturdayDemoStep("completed", [{ ...request, status: "completed", assignedTo: "Demo Housekeeping", proofTaskId: "proof-1" }], request.id, "en");
  assert(result.ok, "server completion with linked proof passes approval");

  assert(parseSaturdayDemoRequests({ requests: [{ ...request, status: "invented" }] }) === null, "unknown server states are rejected");
  assert(parseSaturdayDemoRequests({ error: "unavailable" }) === null, "an error payload is not treated as an empty queue");

  let calls = 0;
  result = await fetchSaturdayDemoVerification({
    requirement: "request_recorded",
    trackedRequestId: null,
    lang: "en",
    request: async (_input, init) => {
      calls += 1;
      assert(init?.method === "GET" && init.cache === "no-store" && init.credentials === "same-origin", "verification is an authenticated no-cache read");
      return Response.json({ requests: [request] });
    },
  });
  assert(calls === 1 && result.ok, "the behavior test verifies the server response");

  result = await fetchSaturdayDemoVerification({
    requirement: "request_recorded",
    trackedRequestId: null,
    lang: "en",
    request: async () => Response.json({ error: "unavailable" }, { status: 503 }),
  });
  assert(!result.ok && result.message.includes("503"), "a server failure blocks the presentation gate");
}

const isDirectRun = process.argv[1]?.includes("saturday-demo-tour.test");
if (isDirectRun) {
  runSaturdayDemoTourTests()
    .then(() => console.log("Saturday demo tour tests passed"))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Saturday demo tour tests failed");
      process.exitCode = 1;
    });
}
