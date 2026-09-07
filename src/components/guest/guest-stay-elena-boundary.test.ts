import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_STAY_ELENA_BOUNDARY_COPY,
  GuestStayElenaBoundary,
} from "./guest-stay-elena-boundary";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (isValidElement(node)) {
    return collectText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

function tryRender(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const type = node.type;
  if (typeof type === "function") {
    return tryRender((type as (props: unknown) => ReactNode)(node.props));
  }
  const children = (node as ReactElement<{ children?: ReactNode }>).props.children;
  if (Array.isArray(children)) {
    return children.map((child) => tryRender(child));
  }
  return tryRender(children);
}

function renderThroughBoundary(children: ReactNode): string {
  const instance = new GuestStayElenaBoundary({ children });
  instance.state = { failed: false };
  try {
    return collectText(tryRender(instance.render()));
  } catch {
    instance.state = GuestStayElenaBoundary.getDerivedStateFromError();
    return collectText(instance.render());
  }
}

function ThrowingElena(): ReactNode {
  throw new Error("must-not-appear digest=xyz stack=hidden");
}

function HealthyElena() {
  return "Isabela · Receptionist";
}

export function runGuestStayElenaBoundaryTests() {
  const logs: unknown[][] = [];
  const originalError = console.error;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  const originalWarn = console.warn;
  const capture = (...args: unknown[]) => {
    logs.push(args);
  };
  console.error = capture;
  console.log = capture;
  console.info = capture;
  console.debug = capture;
  console.warn = capture;
  try {
    const failed = renderThroughBoundary(createElement(ThrowingElena));
    assert(
      failed.includes(GUEST_STAY_ELENA_BOUNDARY_COPY.en),
      "throwing Elena child renders the English fallback",
    );
    assert(
      failed.includes(GUEST_STAY_ELENA_BOUNDARY_COPY.es),
      "throwing Elena child renders the Spanish fallback",
    );
    assert(failed === `${GUEST_STAY_ELENA_BOUNDARY_COPY.en}${GUEST_STAY_ELENA_BOUNDARY_COPY.es}`, "fallback is only the bilingual copy");
    assert(!failed.includes("must-not-appear"), "error.message is not rendered");
    assert(!failed.includes("digest"), "error digest is not rendered");
    assert(!failed.includes("stack"), "error.stack is not rendered");
    assert(logs.length === 0, "boundary does not log on failure");

    const healthy = renderThroughBoundary(createElement(HealthyElena));
    assert(healthy === "Isabela · Receptionist", "normal Isabela branding rendering is unchanged");
    assert(!healthy.includes(GUEST_STAY_ELENA_BOUNDARY_COPY.en), "healthy Elena does not show the fallback");
  } finally {
    console.error = originalError;
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
    console.warn = originalWarn;
  }

  const source = readFileSync(join(process.cwd(), "src/components/guest/guest-stay-elena-boundary.tsx"), "utf8");
  assert(!source.includes("componentDidCatch"), "no catch logger");
  assert(!/console\.(log|info|debug|error|warn)/.test(source), "no console");
  assert(!/error\.message|error\.stack|componentStack|digest/.test(source), "error details are not referenced");
  assert(!/fetch|localStorage|sessionStorage|telemetry/.test(source), "no retry API, storage, or telemetry");
  assert(!/useListings|ListingsProvider|chargeback|dashboard-data|GuestSafeBoundary/.test(source), "no host/private/legacy boundary imports");
  assert(!/\btoken\b/.test(source), "token is not on the Elena boundary");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-elena-boundary.test");
if (isDirectRun) {
  try {
    runGuestStayElenaBoundaryTests();
    console.log("guest-stay-elena-boundary tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-elena-boundary tests failed");
    process.exitCode = 1;
  }
}
