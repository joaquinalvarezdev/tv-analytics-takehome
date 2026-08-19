using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Relay.Api.Features.WeeklySummary;

public static class WeeklySummaryEndpoints
{
    public static IEndpointRouteBuilder MapWeeklySummaryEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/accounts", GetAccountsAsync)
            .WithName("GetAccounts")
            .WithSummary("Lists every account for the demo account picker.")
            .WithDescription(
                "This endpoint is a demo/reviewer affordance standing in for authenticated identity. " +
                "In production the account would be resolved from the authenticated principal " +
                "server-side, never supplied by the client.")
            .Produces<AccountResponse[]>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        app.MapGet("/api/accounts/{id:int}/weekly-summary", GetWeeklySummaryAsync)
            .WithName("GetWeeklySummary")
            .WithSummary("Returns the classified weekly activity summary for one account and week.")
            .WithDescription(
                "Compares the selected week against the median of up to the account's trailing 8 " +
                "complete weeks. weekStart defaults to the account's current (in-progress) week when " +
                "omitted, must be a Monday in the account's local timezone, and cannot be in the future.")
            .Produces<WeeklySummaryResponse>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        return app;
    }

    private static async Task<Results<Ok<AccountResponse[]>, ProblemHttpResult>> GetAccountsAsync(
        WeeklySummaryRepository repository, CancellationToken ct)
    {
        var anchorUtc = await repository.GetAnchorUtcAsync(ct);
        if (anchorUtc is null)
        {
            return TypedResults.Problem(
                title: "Dataset not loaded",
                detail: "No activity events exist yet; the dataset has not finished loading.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var accounts = await repository.GetAccountsAsync(ct);
        var firstEventByAccount = await repository.GetFirstEventUtcByAccountAsync(ct);

        var response = accounts
            .Select(account =>
            {
                var tz = TimeZoneInfo.FindSystemTimeZoneById(account.Timezone);
                var currentWeekStart = ReportingCalendar.CurrentWeekStart(anchorUtc.Value, tz);
                var firstSelectableWeekStart = firstEventByAccount.TryGetValue(account.Id, out var firstEventUtc)
                    ? ReportingCalendar.WeekStartOf(ReportingCalendar.ToLocalDay(firstEventUtc, tz))
                    : (DateOnly?)null;

                return new AccountResponse(account.Id, account.Name, account.Timezone, currentWeekStart, firstSelectableWeekStart);
            })
            .ToArray();

        return TypedResults.Ok(response);
    }

    private static async Task<Results<Ok<WeeklySummaryResponse>, ProblemHttpResult>> GetWeeklySummaryAsync(
        int id,
        DateOnly? weekStart,
        WeeklySummaryRepository repository,
        WeeklySummaryService service,
        CancellationToken ct)
    {
        var account = await repository.GetAccountAsync(id, ct);
        if (account is null)
        {
            return TypedResults.Problem(
                title: "Account not found",
                detail: $"No account exists with id {id}.",
                statusCode: StatusCodes.Status404NotFound);
        }

        var anchorUtc = await repository.GetAnchorUtcAsync(ct);
        if (anchorUtc is null)
        {
            return TypedResults.Problem(
                title: "Dataset not loaded",
                detail: "No activity events exist yet; the dataset has not finished loading.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var tz = TimeZoneInfo.FindSystemTimeZoneById(account.Timezone);
        var currentWeekStart = ReportingCalendar.CurrentWeekStart(anchorUtc.Value, tz);
        var effectiveWeekStart = weekStart ?? currentWeekStart;

        if (effectiveWeekStart.DayOfWeek != DayOfWeek.Monday)
        {
            return TypedResults.Problem(
                title: "Invalid weekStart",
                detail: $"weekStart must be a Monday; {effectiveWeekStart:yyyy-MM-dd} is a {effectiveWeekStart.DayOfWeek}.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        if (effectiveWeekStart > currentWeekStart)
        {
            return TypedResults.Problem(
                title: "Invalid weekStart",
                detail: $"weekStart {effectiveWeekStart:yyyy-MM-dd} has not started yet.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var localStart = effectiveWeekStart.AddDays(-7 * ReportingRules.BaselineWeeks);
        var localEndExclusive = effectiveWeekStart.AddDays(7);
        var (fromUtc, toUtcExclusive) = ReportingCalendar.UtcQueryRange(localStart, localEndExclusive, tz);

        var events = await repository.GetEventsAsync(id, fromUtc, toUtcExclusive, ct);
        var firstEventUtc = await repository.GetFirstEventUtcAsync(id, ct);

        var input = new WeeklySummaryInput(tz, effectiveWeekStart, anchorUtc.Value, firstEventUtc, events);
        var result = service.Build(input);

        return TypedResults.Ok(result.ToResponse(id, account.Timezone));
    }
}
