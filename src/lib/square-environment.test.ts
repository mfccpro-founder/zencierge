import { SquareEnvironment } from "square";

const { isSquareSandbox, resolveSquareEnvironment } = await import(
  new URL("./square-client.ts", import.meta.url).href
);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function rejectionMessage(value: string | undefined) {
  try {
    resolveSquareEnvironment(value);
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  throw new Error("invalid Square environment was accepted");
}

function assertCanonicalAgreement(value: string) {
  const resolved = resolveSquareEnvironment(value);
  assert(
    resolved.sandbox ===
      (resolved.sdkEnvironment === SquareEnvironment.Sandbox),
    "Square SDK environment and sandbox reporting agree",
  );
  assert(
    isSquareSandbox(value) === resolved.sandbox,
    "checkout reporting uses the canonical Square environment resolver",
  );
}

function runSquareEnvironmentTests() {
  const sandbox = resolveSquareEnvironment("sandbox");
  assert(sandbox.name === "sandbox", "explicit sandbox is accepted");
  assert(
    sandbox.sdkEnvironment === SquareEnvironment.Sandbox && sandbox.sandbox,
    "explicit sandbox selects the Sandbox SDK environment",
  );

  const normalizedSandbox = resolveSquareEnvironment("  SaNdBoX  ");
  assert(
    normalizedSandbox.name === "sandbox" && normalizedSandbox.sandbox,
    "sandbox is normalized with trim and lowercase",
  );

  const production = resolveSquareEnvironment("production");
  assert(production.name === "production", "explicit production is accepted");
  assert(
    production.sdkEnvironment === SquareEnvironment.Production &&
      !production.sandbox,
    "explicit production selects the Production SDK environment",
  );

  const expectedError =
    "SQUARE_ENVIRONMENT must be explicitly configured as sandbox or production";
  assert(
    rejectionMessage(undefined) === expectedError,
    "missing Square environment is rejected with a sanitized error",
  );
  assert(
    rejectionMessage("   ") === expectedError,
    "empty Square environment is rejected with a sanitized error",
  );
  assert(
    rejectionMessage("staging") === expectedError,
    "invalid Square environment is rejected with a sanitized error",
  );

  for (const value of ["sandbox", "  SANDBOX ", "production", " Production "]) {
    assertCanonicalAgreement(value);
  }

  console.log("square environment fail-closed tests passed");
}

runSquareEnvironmentTests();
