# 02 — Backend foundation (Task 1)

Sonnet implementation agent. Scope: `Data/`, `Migrations/`, `Program.cs`,
`appsettings*.json`, `Relay.Api.csproj`.

## What was built

- `Data/Account.cs`, `Data/ActivityEvent.cs` — POCO entities matching
  `schema.sql` (snake_case columns via explicit `HasColumnName`, `varchar`
  via `IsUnicode(false)` + `HasMaxLength`, `ValueGeneratedNever()` since IDs
  come from seed data, nullable reference types for `DurationSeconds`/`Outcome`).
- `Data/RelayDbContext.cs` — fluent config in `OnModelCreating`. One
  `ValueConverter<DateTime, DateTime>` shared by `CreatedAt` and `OccurredAt`
  that tags `DateTimeKind.Utc` on read (SQL Server `datetime2` round-trips as
  `Unspecified`); write side passes the value through unchanged — the
  contract is that callers (entities, `SeedImporter`) always supply UTC.
  Index on `(account_id, occurred_at)` as specified. FK delete behavior set
  to `Restrict` explicitly (see decision below).
- `Data/SeedImporter.cs` — hand-rolled parser for `seed.sql` INSERT
  statements (no `sqlcmd`/raw-SQL-exec dependency, since IDs must be
  preserved verbatim and identity columns aren't used). Idempotent (skips if
  `accounts` has any rows), batches `activity_events` inserts (1000/batch)
  with `AutoDetectChangesEnabled = false`, throws with file:line context on
  any parse failure or on zero-row parse. Explicitly does **not** deduplicate
  — see PLAN.md's duplicate-events decision.
- `Migrations/20260819152613_InitialCreate.cs` — generated via
  `dotnet ef migrations add`, not hand-written. Matches schema.sql 1:1.
- `Program.cs` — registers `RelayDbContext` (SQL Server), calls
  `Database.Migrate()` then `SeedImporter.RunAsync()` on startup before
  `app.Run()`. Removed the `WeatherForecast` template endpoint/record.
  Swagger left wired.
- `Relay.Api.csproj` — added the seed.sql `Content Include ... Link="seed.sql"`
  entry exactly as specified.
- `appsettings.Development.json` — `ConnectionStrings:RelayDb` with the
  dev connection string from the spec (port 1433). `appsettings.json`
  untouched (no password, dev-override shape preserved implicitly by
  omission).

## Decisions not fully specified by PLAN.md / the task spec

- **UTC value converter, write side is a no-op.** I considered validating
  `Kind == Utc` on write and throwing otherwise, but that adds a runtime
  check with no real payoff here — every write path (entities constructed by
  `SeedImporter`) already guarantees UTC by construction, and a later
  feature-layer bug would show up immediately as wrong data, not a silent
  local-time bug, given the read-side tagging. Documented the choice in a
  code comment rather than silently doing something clever.
- **FK delete behavior: `Restrict`, not EF's default `Cascade`.**
  `schema.sql`'s bare `REFERENCES accounts(id)` has no `ON DELETE` clause,
  which is `NO ACTION` in SQL Server. EF Core's default for a required
  relationship is `Cascade`, which would silently diverge from schema.sql.
  Set explicitly to `Restrict` to match. Not exercised by seed data (no
  deletes), but matters if this is reviewed against schema.sql line-by-line.
- **Batch size 1000** for `activity_events` inserts — not specified, chosen
  as a reasonable middle ground; full seed completes in low single-digit
  seconds either way, so not perf-critical at this data size.

## Environment issue found (real, reported rather than silently worked around)

The task brief stated the SQL Server container was verified running and
reachable on `localhost:1433`. It **is** running, but on this machine
`localhost:1433` is not actually reachable from the host — a pre-existing
native Windows service, `SQL Server (SQLEXPRESS)` (`sqlservr.exe`,
`MSSQL$SQLEXPRESS`, `StartMode=Auto`), already owns port 1433. All host-side
connections (tested with both `Microsoft.Data.SqlClient` via the app and
raw `System.Data.SqlClient` via PowerShell) landed on the native instance
and failed login (wrong/no matching `sa` credentials there), while
`docker exec ... sqlcmd` succeeded every time because it stays inside the
container's network namespace. I don't have permission to stop the
SQLEXPRESS service (`Stop-Service` failed: "no se puede abrir el servicio").

I did not modify `docker-compose.yaml` (out of scope for this task) or the
delivered `appsettings.Development.json` (kept at the spec's `localhost,1433`
exactly as required) to work around this. Instead, to verify the code itself
end-to-end without leaving the repo in a modified state:

1. Stopped the compose-managed container temporarily.
2. Started a throwaway `docker run` container from the same image, reusing
   the same named volume (`tv-analytics-takehome_sqlserver_data`), mapped to
   host port 14339 instead of 1433.
3. Pointed `appsettings.Development.json` at port 14339 temporarily, ran
   `dotnet run` twice (fresh + idempotency check), verified via `sqlcmd`.
4. Reverted `appsettings.Development.json` to `localhost,1433` (the required
   value), removed the throwaway container, and restarted the original
   compose container — confirmed via `docker exec` on the *original*
   container that the migration + seed data persisted (same volume).

**This means the delivered code is verified correct, but on this machine
`docker compose up -d` + the documented connection string will not actually
work from the host until someone either stops/reconfigures the
SQLEXPRESS service, or the compose file's host port is remapped.** This is
a machine-specific conflict, not a code defect, but it will block whoever
reviews this on the same machine (or any Windows machine with a local SQL
Server Express install) unless surfaced. Flagging for the orchestrator to
decide: document as a known-environment caveat in the README, or remap
`docker-compose.yaml`'s host port (outside my file ownership for this task).

## Verification output

`dotnet build` (final, after all changes): clean, 0 warnings, 0 errors.

Fresh run (via the temporary port-14339 container, see above) — migration
applied (`Applying migration '20260819152613_InitialCreate'`), then:

```
Seed import starting from ...\bin\Debug\net8.0\seed.sql
Seed import complete: 20 accounts, 12626 activity_events.
Now listening on: http://localhost:5000
```

```sql
SELECT COUNT(*) FROM accounts;         -- 20
SELECT COUNT(*) FROM activity_events;  -- 12626
SELECT MIN(occurred_at), MAX(occurred_at) FROM activity_events;
-- 2026-02-01 10:57:44.0000000   2026-07-27 22:20:34.0000000
```

Matches the expected counts and range from the task spec exactly.

Second run (idempotency check):

```
Seed import skipped: accounts table is already populated.
```

Counts after second run: unchanged (20 accounts, 12626 activity_events).

Duplicate check:

```sql
SELECT COUNT(*) FROM (
  SELECT account_id, location, event_type, occurred_at, COUNT(*) c
  FROM activity_events
  GROUP BY account_id, location, event_type, occurred_at
  HAVING COUNT(*) > 1
) x;
-- 12
```

12 duplicate groups survived, matching PLAN.md's documented count. Not
deduplicated, as specified.

Final state: original compose container (`tv-analytics-takehome-sqlserver-1`)
restarted and confirmed to independently show the same 20/12626 counts
(same volume as the verification run). `appsettings.Development.json`
left at the exact connection string specified in the task
(`localhost,1433`).

## Things I think are worth a second look (not blocking, just flagging)

- Nothing in the entity/migration/importer code contradicted the spec. The
  only issue found was the environment port conflict above.
