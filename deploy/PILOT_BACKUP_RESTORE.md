# Pilot backup and restore

The Supabase Free plan does not provide downloadable managed backups. Before any real host data is entered, establish an off-site logical backup schedule.

## Safety rules

- Keep the database URL only in the process-scoped `PILOT_SUPABASE_DB_URL` environment variable.
- Never commit database URLs, passwords, JWTs, service-role keys, dumps, or Storage objects.
- Store the resulting directory in encrypted offline storage.
- Database dumps contain Storage metadata, not the file objects. The scripts transfer allowlisted buckets separately.
- The initial allowlist contains only `housekeeping-proof`. Add a bucket only after reviewing its ownership and retention rules.

## Backup

Run `scripts/pilot-backup.ps1 -ProjectRef <pilot-ref> -Destination <encrypted-folder>` from a trusted machine with Supabase CLI authentication and Docker available. It creates `roles.sql`, `schema.sql`, `data.sql`, the allowlisted Storage tree, and a SHA-256 manifest.

## Restore drill

Restore only into an empty disposable verification project. Set its connection URL in the process-scoped variable, then run `scripts/pilot-restore.ps1 -ProjectRef <verification-ref> -BackupDirectory <backup-folder>`. The script verifies hashes before applying SQL and Storage objects.

After restore, run the catalog postflight and `pilot_host_destination_postflight_readonly_json.sql`; verify Auth identity, ownership counts, token expiry/revocation, RLS/FORCE RLS, grants, signed photo reads, and the exact courtesy expiration. Delete nothing from the source until the owner accepts the drill.
