import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  readFounderHostSubscriptionPages,
  readFounderSubscriptionPaymentPages,
  type FounderBillingRpcClient,
} from "./founder-backoffice-billing-read";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const MIGRATION = "20260926140000_founder_backoffice_billing_read.sql";
const PAYMENT_CAST_MIGRATION = "20260927160000_founder_backoffice_subscription_payments_text_casts.sql";
const ACL_MIGRATION = "20260910130000_subscription_billing_acl_normalization.sql";

function normalize(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function executableSql(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase();
}

function fakeClient(
  pages: Array<{ data?: unknown; error?: { message: string } | null }>,
  calls: Array<{ fn: string; args: Record<string, string | number | boolean | null> }>,
): FounderBillingRpcClient {
  let index = 0;
  return {
    rpc(fn, args) {
      calls.push({ fn, args });
      const page = pages[index] ?? { data: [] };
      index += 1;
      return Promise.resolve({ data: page.data ?? null, error: page.error ?? null });
    },
  };
}

function runFounderBackofficeBillingReadTests() {
  const root = process.cwd();
  const migrationsDir = join(root, "supabase", "migrations");
  const names = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const sql = normalize(readFileSync(join(migrationsDir, MIGRATION), "utf8"));
  const body = executableSql(sql);
  const acl = readFileSync(join(migrationsDir, ACL_MIGRATION), "utf8");

  assert(names.includes(MIGRATION), "founder billing read migration exists");
  assert(names.filter((name) => name.startsWith("20260926140000_")).length === 1, "migration timestamp is unique");
  assert(names.includes(PAYMENT_CAST_MIGRATION), "payment text-cast migration exists");
  assert(names.indexOf(PAYMENT_CAST_MIGRATION) > names.indexOf(MIGRATION), "payment text-cast migration follows the founder read");
  assert(
    names.includes("20260928153000_ai_usage_tts_meter_foundation.sql"),
    "tts meter foundation migration exists",
  );
  assert(
    names.indexOf("20260928153000_ai_usage_tts_meter_foundation.sql") > names.indexOf(PAYMENT_CAST_MIGRATION),
    "tts meter foundation follows the payment text-cast migration",
  );
  assert(names.indexOf(MIGRATION) > names.indexOf(ACL_MIGRATION), "read migration follows 7D1");
  assert(acl.includes("revoke all on table public.host_subscriptions from service_role"), "7D1 still revokes service_role");
  assert(!body.includes("grant select"), "migration does not grant select");
  assert(!body.includes("grant insert") && !body.includes("grant update") && !body.includes("grant delete"), "migration does not grant table writes");
  assert(!body.includes("create policy") && !body.includes("alter policy") && !body.includes("drop policy"), "migration does not change policies");
  assert(!body.includes("revoke all on table"), "migration does not rewrite table ACL");
  assert(body.includes("security definer"), "functions are security definer");
  assert(body.includes("set search_path = pg_catalog"), "functions pin search_path");
  assert(body.includes("revoke all on function public.founder_backoffice_host_subscriptions_page"), "subscriptions function is revoked");
  assert(body.includes("revoke all on function public.founder_backoffice_subscription_payments_page"), "payments function is revoked");
  assert(body.includes("from public"), "execute is revoked from public");
  assert(body.includes("from anon"), "execute is revoked from anon");
  assert(body.includes("from authenticated"), "execute is revoked from authenticated");
  assert(body.includes("grant execute on function public.founder_backoffice_host_subscriptions_page"), "subscriptions execute is granted");
  assert(body.includes("grant execute on function public.founder_backoffice_subscription_payments_page"), "payments execute is granted");
  assert(body.includes("to service_role"), "execute is granted to service_role");
  assert(!body.includes("to authenticated") && !body.includes("to anon") && !body.includes("to public"), "execute is not granted to host roles");
  assert(body.includes("s.created_at > p_after_created_at"), "subscription pages use a created_at cursor");
  assert(body.includes("s.user_id > p_after_user_id"), "subscription pages break created_at ties by user_id");
  assert(body.includes("p.created_at > p_after_created_at"), "payment pages use a created_at cursor");
  assert(body.includes("p.id > p_after_id"), "payment pages break created_at ties by id");
  assert(body.includes("p.created_at < p_after_created_at"), "newest-first pages walk older created_at");
  assert(body.includes("p.id < p_after_id"), "newest-first pages break created_at ties by smaller id");
  assert(body.includes("p.created_at >= p_from") && body.includes("p.created_at < p_to"), "payment window keeps the inclusive start and exclusive end on created_at");
  assert(
    /if p_from is not null and p_to is not null and p_from >= p_to then\s+raise exception using\s+errcode = '22023',\s+message = 'invalid subscription payment read range';/i.test(sql),
    "an inverted payment range raises 22023",
  );
  assert(!/p_from >= p_to then\s+return;/i.test(sql), "an inverted payment range does not return an empty page");
  assert(!sql.includes("*"), "SQL comments are not wrapped in asterisks");
  const castSql = normalize(readFileSync(join(migrationsDir, PAYMENT_CAST_MIGRATION), "utf8"));
  const castBody = executableSql(castSql);
  assert(castSql.includes("p.payment_status::pg_catalog.text"), "payment_status varchar is cast to text");
  assert(castSql.includes("p.gateway_payment_id::pg_catalog.text"), "gateway_payment_id varchar is cast to text");
  assert(castSql.includes("invalid subscription payment read range"), "cast replacement keeps the invalid-range exception");
  assert(!castBody.includes("grant select"), "cast migration does not grant select");
  assert(!castSql.includes("*"), "cast migration comments are not wrapped in asterisks");
  assert(!castSql.includes("founder_backoffice_host_subscriptions_page"), "cast migration does not replace the working MRR function");
  assert(!/p\.paid_at\s*[<>=]/.test(body), "payment window does not filter on nullable paid_at");
  assert(body.includes("least(greatest(coalesce(p_limit, 1000), 1), 1000)"), "page size is capped at 1000");
  assert(!/\bp_user_id\b/.test(sql), "functions do not take a host user argument");
  assert(!/card_id|payment_method|card_brand|card_last/i.test(sql), "functions do not return card identifiers");

  const billing = readFileSync(join(root, "src/lib/admin-billing.ts"), "utf8");
  const income = readFileSync(join(root, "src/lib/admin-income.ts"), "utf8");
  assert(billing.includes("readFounderHostSubscriptionPages"), "billing reads subscriptions through the founder page");
  assert(billing.includes("readFounderSubscriptionPaymentPages"), "billing reads payments through the founder page");
  assert(!/\.from\(\s*["']host_subscriptions["']\s*\)/.test(billing), "billing does not select host_subscriptions directly");
  assert(!/\.from\(\s*["']subscription_payments["']\s*\)/.test(billing), "billing does not select subscription_payments directly");
  assert(income.includes("readFounderSubscriptionPaymentPages"), "income reads payments through the founder page");
  assert(!/\.from\(\s*["']subscription_payments["']\s*\)/.test(income), "income does not select subscription_payments directly");
  const health = readFileSync(join(root, "src/lib/admin-system-health.ts"), "utf8");
  assert(health.includes("readFounderHostSubscriptionPages"), "system health probes subscriptions through the founder page");
  assert(health.includes("readFounderSubscriptionPaymentPages"), "system health reads payments through the founder page");
  assert(!/\.from\(\s*["']host_subscriptions["']\s*\)/.test(health), "system health does not select host_subscriptions directly");
  assert(!/\.from\(\s*["']subscription_payments["']\s*\)/.test(health), "system health does not select subscription_payments directly");
  assert(health.includes("newestFirst: true") && health.includes("pageSize: 500") && health.includes("maxRows: 500"), "system health keeps the newest 500-row payment window");

  const schema = readFileSync(join(root, "supabase/schema.sql"), "utf8");
  const hostTable = schema.slice(
    schema.indexOf("create table if not exists public.host_subscriptions ("),
    schema.indexOf("create table if not exists public.subscription_payments ("),
  );
  const paymentTable = schema.slice(
    schema.indexOf("create table if not exists public.subscription_payments ("),
    schema.indexOf("create index if not exists idx_subscription_payments_user_id"),
  );
  assert(/user_id uuid primary key/.test(hostTable), "host subscription cursor user_id is the primary key");
  assert(/created_at timestamptz not null/.test(hostTable), "host subscription cursor created_at is not null");
  assert(/id uuid primary key/.test(paymentTable), "payment cursor id is the primary key");
  assert(/created_at timestamptz not null/.test(paymentTable), "payment cursor created_at is not null");

  return Promise.all([
    (async () => {
      const calls: Array<{ fn: string; args: Record<string, string | number | boolean | null> }> = [];
      const first = await readFounderHostSubscriptionPages(
        fakeClient(
          [
            {
              data: [
                { user_id: "a", created_at: "2026-09-01T00:00:00.000Z" },
                { user_id: "b", created_at: "2026-09-02T00:00:00.000Z" },
              ],
            },
            { data: [{ user_id: "c", created_at: "2026-09-03T00:00:00.000Z" }] },
          ],
          calls,
        ),
        { pageSize: 2, maxRows: 10 },
      );
      assert(first.error === null && first.rows.length === 3, "subscription pages concatenate a short last page");
      assert(calls[1]?.args.p_after_user_id === "b", "second subscription page continues after the last user_id");
      assert(calls[1]?.args.p_after_created_at === "2026-09-02T00:00:00.000Z", "second subscription page continues after the last created_at");

      const failed = await readFounderHostSubscriptionPages(
        fakeClient([{ error: { message: "permission denied for function" } }], []),
      );
      assert(failed.rows.length === 0, "a failed subscription page returns no rows");
      assert(failed.error?.includes("host_subscriptions") === true, "a failed subscription page names host_subscriptions");

      const capped = await readFounderHostSubscriptionPages(
        fakeClient(
          [
            {
              data: [
                { user_id: "a", created_at: "2026-09-01T00:00:00.000Z" },
                { user_id: "b", created_at: "2026-09-02T00:00:00.000Z" },
              ],
            },
          ],
          [],
        ),
        { pageSize: 2, maxRows: 2 },
      );
      assert(capped.rows.length === 0 && capped.error?.includes("safety cap") === true, "a full page at the cap is not a complete catalog");
    })(),
    (async () => {
      const calls: Array<{ fn: string; args: Record<string, string | number | boolean | null> }> = [];
      const read = await readFounderSubscriptionPaymentPages(
        fakeClient(
          [
            {
              data: [
                { id: "p1", created_at: "2026-09-01T00:00:00.000Z", amount_usd: 49 },
                { id: "p2", created_at: "2026-09-02T00:00:00.000Z", amount_usd: 49 },
              ],
            },
            { data: [] },
          ],
          calls,
        ),
        { fromIso: "2026-09-01T00:00:00.000Z", toIso: "2026-10-01T00:00:00.000Z", pageSize: 2, maxRows: 10 },
      );
      assert(read.error === null && read.rows.length === 2, "an empty following page ends the payment read");
      assert(calls[0]?.args.p_from === "2026-09-01T00:00:00.000Z", "payment read passes the range start");
      assert(calls[0]?.args.p_after_id === null, "the first payment page has no cursor");
      assert(calls[0]?.args.p_newest_first === false, "income pages walk oldest first");
      assert(calls[1]?.args.p_after_id === "p2", "the next payment page continues after the last id");

      const newestCalls: Array<{ fn: string; args: Record<string, string | number | boolean | null> }> = [];
      await readFounderSubscriptionPaymentPages(
        fakeClient([{ data: [] }], newestCalls),
        { fromIso: "2026-08-28T00:00:00.000Z", toIso: null, pageSize: 500, maxRows: 500, newestFirst: true },
      );
      assert(newestCalls[0]?.args.p_newest_first === true, "the health sample requests the newest page");
      assert(newestCalls[0]?.args.p_to === null, "the health sample has no upper bound");
      assert(newestCalls[0]?.args.p_limit === 500, "the health sample keeps the 500-row limit");

      const later = await readFounderSubscriptionPaymentPages(
        fakeClient(
          [
            { data: [{ id: "p1", created_at: "2026-09-01T00:00:00.000Z" }] },
            { error: { message: "Could not find the function founder_backoffice_subscription_payments_page" } },
          ],
          [],
        ),
        { fromIso: "2026-09-01T00:00:00.000Z", toIso: "2026-10-01T00:00:00.000Z", pageSize: 1, maxRows: 10 },
      );
      assert(later.rows.length === 0, "a later payment page failure discards the partial page");
      assert(later.error?.includes("subscription_payments") === true, "a failed payment page names subscription_payments");

      const empty = await readFounderSubscriptionPaymentPages(
        fakeClient([{ data: [] }], []),
        { fromIso: "2026-09-01T00:00:00.000Z", toIso: "2026-10-01T00:00:00.000Z" },
      );
      assert(empty.error === null && empty.rows.length === 0, "a successful empty payment page is an empty read");
    })(),
  ]);
}

runFounderBackofficeBillingReadTests()
  .then(() => {
    console.log("founder-backoffice-billing-read tests passed");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
