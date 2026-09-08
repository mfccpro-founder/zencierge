import { applySubscriptionWebhook } from "@/lib/subscription-webhooks";
import {
  genericSubscriptionWebhookConfig,
  handleGenericSubscriptionWebhook,
} from "@/lib/generic-subscription-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleGenericSubscriptionWebhook({
    config: genericSubscriptionWebhookConfig(),
    xWebhookSecret: request.headers.get("x-webhook-secret"),
    authorization: request.headers.get("authorization"),
    readBody: () => request.json() as Promise<unknown>,
    applyEvent: applySubscriptionWebhook,
  });

  return Response.json(result.body, { status: result.status });
}
