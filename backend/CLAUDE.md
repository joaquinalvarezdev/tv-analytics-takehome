# Backend CLAUDE.md

## Stack

- .NET 8
- Modern idiomatic C#
- ASP.NET Core Web API
- Entity Framework Core
- Microsoft SQL Server
- xUnit
- Swagger / OpenAPI

## Architecture

- Use dependency injection consistently.
- Use repositories for data-access boundaries where they provide useful separation from EF Core.
- Keep repositories focused; do not build a generic repository framework.
- Keep architecture proportional to the size of the feature.
- Do not introduce CQRS, MediatR, Clean Architecture projects, or similar abstractions unless there is a concrete requirement.
- Prefer feature-oriented organization for DASH-247.

## C#

- Write idiomatic modern C# supported by the .NET 8 target.
- Prefer clear expression-bodied members, pattern matching, records, LINQ, nullable reference types, async/await, and other modern language features where they improve clarity.
- Avoid cleverness for its own sake.
- Follow DRY where duplication represents the same concept, but do not create abstractions prematurely.
- Extract helpers/services when logic is genuinely reusable or deserves independent testing.
- Avoid catch-all `Utils` classes.

## Data

- Target Microsoft SQL Server behavior and semantics.
- Treat timezone and reporting-period calculations as correctness-sensitive.
- Keep aggregation logic explicit and reviewable.
- Do not silently deduplicate or normalize supplied data unless the product semantics justify it.
- Use real EF Core migrations for schema changes.

## API / OpenAPI

- Use explicit request and response DTOs for external API contracts.
- Keep Swagger/OpenAPI metadata accurate.
- Use ASP.NET Core attributes/annotations where they materially improve the generated contract.
- The frontend consumes a generated OpenAPI client; avoid response shapes that require hand-written frontend DTO duplication.
- Do not leak EF entities directly through the API.

## Testing

- Optimize for confidence, not coverage percentage.
- Prefer fewer meaningful tests over large numbers of superficial tests.
- Prioritize tests around:
  - aggregation correctness
  - reporting-window boundaries
  - timezone behavior
  - unusual/empty data
  - baseline calculations
  - location-level behavior
- Avoid tests that merely assert framework or trivial property behavior.

## Verification

For meaningful backend changes run:

`dotnet build`
`dotnet test`

When database behavior changes, verify migrations against SQL Server as well.