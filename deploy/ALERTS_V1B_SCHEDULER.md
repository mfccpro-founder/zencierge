# Alerts V1B — Vercel Cron activation (OFF until intentionally enabled)

Prepared config (not live): `deploy/vercel.crons.alerts-v1b.example.json`

## Future cron

- Path: `/api/cron/system-health-alerts`
- Schedule: `*/15 * * * *` (every 15 minutes)
- Method: GET (Vercel Cron default)

## Auth (compatible — no route redesign)

1. Set `CRON_SECRET` in the Vercel project environment (same secret used locally).
2. Vercel Cron injects `Authorization: Bearer <CRON_SECRET>` on scheduled requests.
3. Manual runs may still use `x-cron-secret` or Bearer.

Do not hard-code secrets. Do not commit secrets.

## Required production env (already used by V1A)

- `CRON_SECRET`
- `FOUNDER_ALERT_EMAILS`
- `FOUNDER_ALERT_FROM`
- `RESEND_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (and existing Supabase URL/key as deployed today)

## Activation steps (later)

1. Confirm Vercel plan allows 15-minute crons (Pro or equivalent).
2. Ensure production env vars above are set in Vercel.
3. Merge prepared crons into root `vercel.json` (or copy example contents into `vercel.json`).
4. Set `SYSTEM_HEALTH_ALERTS_SCHEDULER_ENABLED` to `true` in `admin-system-health-alerts-shared.ts` so Founder System shows Scheduler ON.
5. Deploy.
6. Confirm one successful scheduled GET in Vercel Cron logs (no tight retries; durable state handles duplicates).

## Keep OFF now

- Do not create root `vercel.json` crons until activation.
- Do not upgrade Vercel solely for this until beta/production decision.
