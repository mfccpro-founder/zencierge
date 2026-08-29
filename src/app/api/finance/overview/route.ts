import { composeDailyBriefingText } from "@/lib/dailyBriefing";
import { getDemoFinancePayload } from "@/lib/finance-demo";
import { getUserFinanceContext } from "@/lib/financialMetrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId")?.trim();
  if (!userId) {
    return Response.json(getDemoFinancePayload());
  }

  try {
    const { user, overview } = await getUserFinanceContext(userId);
    const briefing = composeDailyBriefingText(user, overview);
    return Response.json({ overview, briefing, demo: false });
  } catch {
    return Response.json(getDemoFinancePayload());
  }
}

