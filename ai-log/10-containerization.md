# 10 — Containerization (backend + frontend Docker, docker compose up)

Sonnet implementation agent. Scope: `docker-compose.yaml`, `backend/Dockerfile` (new),
`frontend/Dockerfile` (new), `frontend/nginx.conf` (new), `.dockerignore` (new, repo root),
`frontend/.dockerignore` (new), this file. Did not touch `README.md`, `PLAN.md`, `TASKS.md`, any
`.cs`/`.ts`/`.html` source, `appsettings.Development.json`, `seed.sql`, or `schema.sql`.

## Hard constraint this session operated under

A human was doing manual QA against a live stack at the same time: SQL Server container on host
port 14330, API via `dotnet run` on 5041, Angular dev server via `npm start` on 4200. The
orchestrator's brief explicitly forbade `docker compose up/down/restart/stop/rm` or touching
anything on those three ports. Consequently **`docker compose up` for the new all-in-Docker path
was never run in this session** — only `docker compose build` / `docker build` /
`docker run --rm ... <image>` (no compose lifecycle command), which do not affect running
containers. This is a real gap: the wiring below is verified by inspection and by running each
image standalone (`docker run --rm`), not by an end-to-end compose-up smoke test hitting `web` →
`api` → `sqlserver` together. The orchestrator should run `docker compose up` once QA finishes
before calling this done.

## The seed.sql build-context gotcha (the reason `context: .` matters)

`Relay.Api.csproj` has:

```xml
<Content Include="..\..\seed.sql" Link="seed.sql" CopyToOutputDirectory="PreserveNewest" />
```

That's a relative link two directories above the csproj — i.e. the repo root's `seed.sql` — copied
into the build output as `seed.sql` next to `Relay.Api.dll`. `SeedImporter` reads it from there at
startup and throws if it's missing. If the Docker build context were `backend/` (the more obvious
choice for "the backend Dockerfile"), the build could never see `seed.sql` at all — `dotnet
publish` would silently produce a working assembly with no `seed.sql` in the output, and the
container would only fail *at runtime*, after the DB migrated cleanly, which is a much worse place
to discover it. Fix: `docker-compose.yaml`'s `api` service uses `context: .` (repo root) +
`dockerfile: backend/Dockerfile`, and the Dockerfile does `COPY backend/ backend/` and
`COPY seed.sql seed.sql` before `dotnet publish`.

Verified concretely, not just by reading the Dockerfile: after `docker compose build api`, ran

```
docker run --rm --entrypoint sh tv-analytics-takehome-api:latest -c "ls -la /app/seed.sql && wc -l /app/seed.sql"
```

→ `-rwxr-xr-x 1 root root 2448212 ... /app/seed.sql`, `12652 /app/seed.sql` — present and the
right size. The Dockerfile also has a build-time guard (`RUN test -f /app/publish/seed.sql || exit
1`) so this fails loudly at `docker build` time in the future rather than quietly at container
startup if the COPY layout ever regresses.

## Angular build output path

`angular.json` doesn't set an explicit `outputPath`, so `@angular/build:application` (the new
Angular 21 builder) uses its default, which nests under `browser/`. Confirmed against both an
existing local build already present in the repo (`frontend/dist/relay-dashboard/browser/`) and a
fresh build inside the Docker build stage — not assumed from framework version knowledge alone.
`frontend/Dockerfile`'s final stage copies `/app/dist/relay-dashboard/browser` into
`/usr/share/nginx/html`.

## nginx `/api` proxy — mirrors `proxy.conf.json`, not a rewrite

Backend routes are already prefixed `/api/...` (`app.MapGet("/api/accounts", ...)` etc. in
`WeeklySummaryEndpoints.cs`), same as what `proxy.conf.json` forwards unmodified in dev
(`{ "/api": { "target": "http://localhost:5041" } }`). `frontend/nginx.conf` does the equivalent:
`location /api/ { proxy_pass http://api:8080; ... }` — no URI suffix on `proxy_pass`, so nginx
passes the original request path through unchanged (`/api/accounts` → `http://api:8080/api/accounts`),
avoiding a path-rewrite bug where the location prefix silently gets stripped or duplicated.

`api` is the compose service name (works because compose services share a network with per-service
DNS); `8080` is the API's in-container port, set explicitly via `ASPNETCORE_URLS=http://+:8080` in
both `backend/Dockerfile` (`ENV`) and `docker-compose.yaml` (`environment:`, redundant but keeps the
compose file self-documenting) — the aspnet base image doesn't reliably default to a fixed port
across versions, so this was made explicit per the brief rather than relied on implicitly.

## Deviation from the brief: `npm ci` → `npm install`

The brief specified `npm ci` then `npm run build`. `npm ci` failed:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json or
npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error Missing: @emnapi/core@1.11.3 from lock file
npm error Missing: @emnapi/runtime@1.11.3 from lock file
```

Confirmed by inspection this is real drift, not a platform quirk triggered by building on
`node:20-alpine`: `frontend/package-lock.json` has `node_modules/@emnapi/wasi-threads` but not
`@emnapi/core` / `@emnapi/runtime`, which the `tailwindcss`/`@tailwindcss/postcss` v4 toolchain in
`package.json` resolves to. Pre-existing lockfile/package.json drift, unrelated to
containerization, and not something this task's boundaries permit fixing (package-lock.json wasn't
explicitly off-limits, but regenerating it correctly is a frontend-source-adjacent call the
orchestrator should make, not something to do silently mid-Dockerfile-authoring). Worked around by
using `npm install` instead of `npm ci` in `frontend/Dockerfile`, with an inline comment explaining
why, and flagging it here and in the final report. This does not affect the live dev-server QA
session — `npm start` doesn't validate the lockfile at all, it just uses whatever's already in
`node_modules`.

**Orchestrator decision needed:** regenerate `frontend/package-lock.json` properly (e.g. `npm
install` on a clean checkout, ideally cross-checked that it doesn't just re-encode the same
Windows-host bias) and switch the Dockerfile back to `npm ci` for reproducible installs, or accept
`npm install` as-is for a take-home. Left as `npm install` for now since it unblocks the build
without touching frontend-owned files.

## SQL Server healthcheck

Added to the existing `sqlserver` service (image/credentials/volume/host-port untouched, per the
"must not regress local dev" constraint):

```yaml
healthcheck:
  test:
    - CMD-SHELL
    - /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$$MSSQL_SA_PASSWORD" -C -Q "SELECT 1" -b -o /dev/null
  interval: 10s
  timeout: 5s
  retries: 10
  start_period: 30s
```

`-C` (trust server cert) is required because `sqlcmd18` defaults to encrypted connections and
validates the cert; without it every healthcheck probe fails against the container's self-signed
cert even though the DB is actually up. `$$` escapes the `$` for docker-compose's own
variable-interpolation pass so the shell inside the container sees `$MSSQL_SA_PASSWORD` intact.
`api`'s `depends_on: sqlserver: condition: service_healthy` gates startup on this instead of racing
a cold DB — `Database.Migrate()` + seed import in `Program.cs` would otherwise be racing SQL
Server's ~20–40s cold-start.

This healthcheck was added to the compose file but, per the constraint above, was never exercised
by an actual `docker compose up` — its `sqlcmd` path and flags are correct against
`mcr.microsoft.com/mssql/server:2022-latest`'s documented layout, but the depends_on-gated startup
sequencing (api waiting for healthy, then migrating, then serving) is unverified end-to-end.

## Port summary

| Service | Container port | Host port | Notes |
|---|---|---|---|
| `sqlserver` | 1433 | 14330 | unchanged — local dev (`dotnet run` + `npm start`) still targets this |
| `api` (new) | 8080 | 8081 | `ASPNETCORE_URLS=http://+:8080`; distinct from dev's 5041 |
| `web` (new) | 80 (nginx default) | 8080 | distinct from dev's 4200; nginx proxies `/api` to `http://api:8080` internally |

## What was verified

- `docker compose config --quiet` — compose file parses and is internally consistent.
- `docker compose build api` — clean build; seed.sql presence verified inside the built image (see
  above), not just assumed from the Dockerfile.
- `docker compose build web` — clean build after the `npm install` workaround; verified
  `/usr/share/nginx/html` contents and `/etc/nginx/conf.d/default.conf` inside the built image via
  `docker run --rm tv-analytics-takehome-web:latest sh -c '...'`.
- `docker ps` before and after all work: only `tv-analytics-takehome-sqlserver-1` running,
  unchanged status/ports throughout — no container was started, stopped, or recreated by this
  session.

## What was NOT verified (explicitly, per the no-`compose up` constraint)

- End-to-end `docker compose up`: API actually reaching a healthy `sqlserver`, migrating, seeding,
  and serving; `web` container's nginx actually proxying a live `/api/accounts` request through to
  a live `api` container; the SPA loading and rendering real data through the containerized path.
  None of this was exercised. The orchestrator should run `docker compose up` (after the human's
  QA session ends) and hit `http://localhost:8080` and `http://localhost:8081/swagger` before
  calling containerization done.
