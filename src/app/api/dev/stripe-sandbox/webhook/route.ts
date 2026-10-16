import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createStripeSandboxPersistence } from "@/lib/stripe-sandbox-persistence";
import { persistStripeSandboxWebhook } from "@/lib/stripe-sandbox-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  let persistence;
  try {
    persistence = createStripeSandboxPersistence(createSupabaseAdminClient());
  } catch {
    return Response.json(
      { error: "Stripe Sandbox webhook persistence failed" },
      { status: 503 },
    );
  }

  const result = await persistStripeSandboxWebhook(
    {
      nodeEnv: process.env.NODE_ENV,
      secret: process.env.STRIPE_SANDBOX_WEBHOOK_SECRET,
      rawBody,
      signature: request.headers.get("stripe-signature"),
    },
    persistence,
  );
  return Response.json(result.body, { status: result.status });
}
