import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { id?: string; kind?: string };
  try {
    body = (await request.json()) as { id?: string; kind?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id?.trim();
  const kind = body.kind;
  if (!id || (kind !== "recurring_bill" && kind !== "credit_card")) {
    return Response.json({ error: "id and kind are required" }, { status: 400 });
  }

  if (kind === "credit_card") {
    return Response.json({ ok: true, kind, note: "Card due dates are calendar-based; marked paid in this session." });
  }

  try {
    await prisma.recurringBill.update({
      where: { id },
      data: { isPaid: true },
    });
    return Response.json({ ok: true, kind, id });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not mark as paid";
    return Response.json({ error: message }, { status: 503 });
  }
}
