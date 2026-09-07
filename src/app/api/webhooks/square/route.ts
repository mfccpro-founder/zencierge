import { applySubscriptionWebhook } from "@/lib/subscription-webhooks";
import {
  handleSquareWebhook,
  squareWebhookConfig,
  verifySquareWebhookSignature,
} from "@/lib/square-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await handleSquareWebhook({
    rawBody,
    signatureHeader: request.headers.get("x-square-hmacsha256-signature"),
    config: squareWebhookConfig(),
    verifySignature: verifySquareWebhookSignature,
    applyEvent: applySubscriptionWebhook,
  });
  return Response.json(result.body, { status: result.status });
}
