import { isSuperAdmin } from "@/lib/admin-auth";
import {
  createBusinessExpense,
  deleteBusinessExpense,
  updateBusinessExpense,
} from "@/lib/admin-expenses";
import { requireHostUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

async function requireFounder() {
  const auth = await requireHostUser();
  if (auth.error) return { error: auth.error as Response };
  if (!auth.user || !isSuperAdmin(auth.user)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function POST(request: Request) {
  const gate = await requireFounder();
  if ("error" in gate) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await createBusinessExpense({
    body: {
      expenseDate: body.expenseDate ?? body.expense_date,
      category: body.category,
      vendor: body.vendor,
      description: body.description,
      amountUsd: body.amountUsd ?? body.amount_usd,
      recurring: body.recurring,
      recurrenceNote: body.recurrenceNote ?? body.recurrence_note,
    },
    actorUserId: gate.user.id,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, expense: result.row });
}

export async function PATCH(request: Request) {
  const gate = await requireFounder();
  if ("error" in gate) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const result = await updateBusinessExpense({
    id,
    body: {
      expenseDate: body.expenseDate ?? body.expense_date,
      category: body.category,
      vendor: body.vendor,
      description: body.description,
      amountUsd: body.amountUsd ?? body.amount_usd,
      recurring: body.recurring,
      recurrenceNote: body.recurrenceNote ?? body.recurrence_note,
    },
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, expense: result.row });
}

export async function DELETE(request: Request) {
  const gate = await requireFounder();
  if ("error" in gate) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const result = await deleteBusinessExpense(id);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
}
