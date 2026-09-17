import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { createSquareClient } from "@/lib/square-client";
import { tryCreateSupabaseSquareBillingStores } from "@/lib/square-billing-supabase-stores";
import {
  enrollSquareSubscription,
  mapEnrollErrorToHttpStatus,
  type SquareEnrollClient,
} from "@/lib/square-subscription-enroll";

export const dynamic = "force-dynamic";

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toEnrollClient(
  client: ReturnType<typeof createSquareClient>["client"],
): SquareEnrollClient {
  return {
    customers: {
      search: (input) => client.customers.search(input),
      retrieve: (input) => client.customers.get({ customerId: input.customerId }),
      create: (input) => client.customers.create(input),
    },
    cards: {
      create: async (input) => {
        const response = await client.cards.create({
          idempotencyKey: input.idempotencyKey,
          sourceId: input.sourceId,
          ...(input.verificationToken
            ? { verificationToken: input.verificationToken }
            : {}),
          card: {
            customerId: input.card.customerId,
            ...(input.card.cardholderName
              ? { cardholderName: input.card.cardholderName }
              : {}),
            ...(input.card.billingAddress
              ? {
                  billingAddress: {
                    postalCode: input.card.billingAddress.postalCode,
                    country: (input.card.billingAddress.country ?? "US") as "US",
                  },
                }
              : {}),
            ...(input.card.referenceId
              ? { referenceId: input.card.referenceId }
              : {}),
          },
        });
        return {
          card: response.card
            ? {
                id: response.card.id,
                cardBrand: response.card.cardBrand ?? null,
                last4: response.card.last4 ?? null,
                expMonth:
                  response.card.expMonth === null ||
                  response.card.expMonth === undefined
                    ? null
                    : Number(response.card.expMonth),
                expYear:
                  response.card.expYear === null ||
                  response.card.expYear === undefined
                    ? null
                    : Number(response.card.expYear),
              }
            : undefined,
        };
      },
    },
    subscriptions: {
      get: async (input) => {
        const response = await client.subscriptions.get({
          subscriptionId: input.subscriptionId,
        });
        return {
          subscription: response.subscription
            ? {
                id: response.subscription.id,
                status: response.subscription.status,
                customerId: response.subscription.customerId ?? null,
                locationId: response.subscription.locationId ?? null,
              }
            : null,
        };
      },
      create: async (input) => {
        const response = await client.subscriptions.create(input);
        return {
          subscription: response.subscription
            ? {
                id: response.subscription.id,
                status: response.subscription.status,
                version:
                  response.subscription.version === null ||
                  response.subscription.version === undefined
                    ? null
                    : Number(response.subscription.version),
                startDate: response.subscription.startDate ?? null,
                chargedThroughDate:
                  response.subscription.chargedThroughDate ?? null,
                canceledDate: response.subscription.canceledDate ?? null,
              }
            : null,
        };
      },
    },
  };
}

export async function POST(request: Request) {
  const supabase = await createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return Response.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }

  const record = body as Record<string, unknown>;
  const intentId = asOptionalString(record.intentId);
  const sourceId = asOptionalString(record.sourceId);
  const verificationToken = asOptionalString(record.verificationToken);
  const cardholderName = asOptionalString(record.cardholderName);
  const postalCode = asOptionalString(record.postalCode);

  if (!intentId) {
    return Response.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }

  const stores = tryCreateSupabaseSquareBillingStores();
  if (!stores) {
    return Response.json(
      { ok: false, error: "unavailable" },
      { status: 502 },
    );
  }

  let square: SquareEnrollClient;
  try {
    square = toEnrollClient(createSquareClient().client);
  } catch {
    return Response.json(
      { ok: false, error: "unavailable" },
      { status: 502 },
    );
  }

  const result = await enrollSquareSubscription(
    {
      intentId,
      userId: user.id,
      email: user.email ?? "",
      userMetadata: user.user_metadata ?? null,
      sourceId,
      verificationToken,
      cardholderName,
      postalCode,
    },
    { stores, square },
  );

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        intentId: result.intentId,
        status: result.status,
        error: result.error,
      },
      { status: mapEnrollErrorToHttpStatus(result.error) },
    );
  }

  return Response.json({
    ok: true,
    intentId: result.intentId,
    subscriptionId: result.subscriptionId,
    status: result.status,
  });
}
