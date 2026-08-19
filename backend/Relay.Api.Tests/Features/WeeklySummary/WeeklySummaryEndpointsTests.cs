using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Relay.Api.Features.WeeklySummary;

namespace Relay.Api.Tests.Features.WeeklySummary;

/// <summary>
/// The HTTP contract for the weekly-summary endpoints, exercised through the real pipeline.
/// </summary>
/// <remarks>
/// These cover what the domain unit tests structurally cannot: parameter validation, the default
/// week, error status codes and their bodies. The arithmetic itself is verified in
/// <see cref="WeeklySummaryServiceTests"/> against hand-built inputs — asserted here only far enough
/// to prove the endpoint wires the right account, week and anchor into the domain.
/// </remarks>
public class WeeklySummaryEndpointsTests(StandardApiFactory factory) : IClassFixture<StandardApiFactory>
{
    private readonly HttpClient client = factory.CreateClient();

    [Fact]
    public async Task GetAccounts_DerivesCurrentAndFirstSelectableWeekPerAccount()
    {
        var accounts = await client.GetFromJsonAsync<AccountResponse[]>("/api/accounts", ApiJson.Options);

        Assert.NotNull(accounts);
        Assert.Equal(2, accounts.Length);

        var active = accounts.Single(a => a.Id == TestSeed.ActiveAccountId);
        Assert.Equal(TestSeed.CurrentWeekStart, active.CurrentWeekStart);
        Assert.Equal(TestSeed.FirstBaselineWeekStart, active.FirstSelectableWeekStart);

        // The anchor is dataset-wide, so an account with no events of its own still resolves to a
        // current week (in its own timezone) rather than dropping off the picker.
        var silent = accounts.Single(a => a.Id == TestSeed.SilentAccountId);
        Assert.Equal(TestSeed.CurrentWeekStart, silent.CurrentWeekStart);
        Assert.Null(silent.FirstSelectableWeekStart);
    }

    [Fact]
    public async Task GetWeeklySummary_WithoutWeekStart_DefaultsToTheInProgressWeek()
    {
        var summary = await client.GetFromJsonAsync<WeeklySummaryResponse>(
            $"/api/accounts/{TestSeed.ActiveAccountId}/weekly-summary", ApiJson.Options);

        Assert.NotNull(summary);
        Assert.Equal(TestSeed.CurrentWeekStart, summary.WeekStart);
        Assert.Equal(TestSeed.CurrentWeekStart.AddDays(6), summary.WeekEnd);

        // Monday: the week is one day old, so throughDate is the anchor's local day, not the Sunday.
        Assert.Equal(TestSeed.CurrentWeekStart, summary.ThroughDate);
        Assert.True(summary.ThroughDate < summary.WeekEnd);

        Assert.Equal(DataStatus.Ok, summary.DataStatus);
        Assert.Equal(TestSeed.BaselineWeeks, summary.BaselineWeeksUsed);
        Assert.Equal(TestSeed.CurrentWeekCountedEvents, summary.Totals.Current);
        Assert.Equal(TestSeed.BaselineEventsPerWeek, summary.Totals.BaselineMedian);
        Assert.Equal(1.5m, summary.Totals.DeltaRatio); // 5 vs 2: +150%, and |5-2| clears the 3-event floor
        Assert.Equal(ActivityStatus.Above, summary.Totals.Status);
    }

    [Fact]
    public async Task GetWeeklySummary_ComparesAgainstEquivalentlyTruncatedHistory()
    {
        var summary = await client.GetFromJsonAsync<WeeklySummaryResponse>(
            $"/api/accounts/{TestSeed.ActiveAccountId}/weekly-summary", ApiJson.Options);

        Assert.NotNull(summary);
        Assert.Equal(TestSeed.BaselineWeeks, summary.ComparisonHistory.Count);

        // Each historical window is cut at the same elapsed point as the reported week — Monday —
        // so none of them runs to its own Sunday.
        Assert.All(summary.ComparisonHistory, window =>
        {
            Assert.Equal(window.WeekStart, window.ThroughDate);
            Assert.Equal(TestSeed.BaselineEventsPerWeek, window.Total);
        });

        // The median the verdict used is reproducible from the windows the response returned.
        var totals = summary.ComparisonHistory.Select(w => w.Total).Order().ToList();
        var median = (totals[totals.Count / 2 - 1] + totals[totals.Count / 2]) / 2m;
        Assert.Equal(median, summary.Totals.BaselineMedian);
    }

    [Fact]
    public async Task GetWeeklySummary_AccountWithNoEvents_ReturnsNoActivityRatherThanAnError()
    {
        var response = await client.GetAsync($"/api/accounts/{TestSeed.SilentAccountId}/weekly-summary");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var summary = await response.Content.ReadFromJsonAsync<WeeklySummaryResponse>(ApiJson.Options);

        Assert.NotNull(summary);
        Assert.Equal(DataStatus.NoActivity, summary.DataStatus);
        Assert.Equal(0, summary.BaselineWeeksUsed);
        Assert.Equal(0, summary.Totals.Current);
        Assert.Null(summary.Totals.BaselineMedian); // null: no baseline computable, distinct from a zero one
        Assert.Equal(ActivityStatus.NoVerdict, summary.Totals.Status);
        Assert.Empty(summary.Locations);
    }

    [Fact]
    public async Task GetWeeklySummary_NonMondayWeekStart_IsRejected()
    {
        // 2026-07-28 is a Tuesday.
        var response = await client.GetAsync(
            $"/api/accounts/{TestSeed.ActiveAccountId}/weekly-summary?weekStart=2026-07-28");

        await AssertProblem(response, HttpStatusCode.BadRequest, "Invalid weekStart");
    }

    [Fact]
    public async Task GetWeeklySummary_WeekStartAfterTheAnchorWeek_IsRejected()
    {
        var nextWeek = TestSeed.CurrentWeekStart.AddDays(7);
        var response = await client.GetAsync(
            $"/api/accounts/{TestSeed.ActiveAccountId}/weekly-summary?weekStart={nextWeek:yyyy-MM-dd}");

        await AssertProblem(response, HttpStatusCode.BadRequest, "Invalid weekStart");
    }

    [Fact]
    public async Task GetWeeklySummary_UnparseableWeekStart_IsRejected()
    {
        // Rejected by parameter binding rather than by the handler, so it reaches the catch-all as a
        // BadHttpRequestException. The caller must still see a 400 — a naive catch-all would report
        // this as a 500.
        var response = await client.GetAsync(
            $"/api/accounts/{TestSeed.ActiveAccountId}/weekly-summary?weekStart=last-monday");

        await AssertProblem(response, HttpStatusCode.BadRequest, "Invalid request");
    }

    [Fact]
    public async Task GetWeeklySummary_UnknownAccount_IsNotFound()
    {
        var response = await client.GetAsync("/api/accounts/999/weekly-summary");

        await AssertProblem(response, HttpStatusCode.NotFound, "Account not found");
    }

    [Fact]
    public async Task GetWeeklySummary_EarliestSelectableWeek_ReportsInsufficientHistoryNotAVerdict()
    {
        // The account's first week has nothing before it, so there is no baseline to judge it
        // against: raw counts, no verdict.
        var response = await client.GetAsync(
            $"/api/accounts/{TestSeed.ActiveAccountId}/weekly-summary" +
            $"?weekStart={TestSeed.FirstBaselineWeekStart:yyyy-MM-dd}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var summary = await response.Content.ReadFromJsonAsync<WeeklySummaryResponse>(ApiJson.Options);

        Assert.NotNull(summary);
        Assert.Equal(DataStatus.InsufficientHistory, summary.DataStatus);
        Assert.Equal(0, summary.BaselineWeeksUsed);
        Assert.Equal(TestSeed.BaselineEventsPerWeek, summary.Totals.Current); // the raw count still shows
        Assert.Null(summary.Totals.BaselineMedian);
        Assert.Equal(ActivityStatus.NoVerdict, summary.Totals.Status);
    }

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode expected, string expectedTitle)
    {
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>(ApiJson.Options);
        Assert.NotNull(problem);
        Assert.Equal(expectedTitle, problem.Title);
        Assert.Equal((int)expected, problem.Status);
    }
}

/// <summary>The endpoints' behaviour before the dataset has been loaded — no events, so no anchor.</summary>
public class WeeklySummaryEndpointsEmptyDatasetTests
{
    [Fact]
    public async Task BothEndpoints_ReportServiceUnavailable_RatherThanInventingAnAnchor()
    {
        using var factory = new TestApiFactory(TestSeed.AccountsWithoutEvents);
        var client = factory.CreateClient();

        var accounts = await client.GetAsync("/api/accounts");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, accounts.StatusCode);

        var summary = await client.GetAsync($"/api/accounts/{TestSeed.ActiveAccountId}/weekly-summary");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, summary.StatusCode);

        // An unknown account is still a 404: the account check is the more specific answer.
        var unknown = await client.GetAsync("/api/accounts/999/weekly-summary");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }
}

/// <summary>The catch-all: an unforeseen failure is still a well-shaped response.</summary>
public class UnhandledExceptionTests
{
    [Fact]
    public async Task UnexpectedFailure_IsProblemDetails500_AndLeaksNothing()
    {
        // A stored timezone that is not a real IANA id throws inside the handler.
        using var factory = new TestApiFactory(TestSeed.AccountWithUnknownTimezone);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/accounts");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        var problem = JsonSerializer.Deserialize<ProblemDetails>(body, ApiJson.Options);

        Assert.NotNull(problem);
        Assert.Equal("Unexpected error", problem.Title);
        Assert.Equal(StatusCodes.Status500InternalServerError, problem.Status);

        // The diagnosis goes to the log, not to the client.
        Assert.DoesNotContain("Mars/Olympus_Mons", body);
        Assert.DoesNotContain("TimeZoneNotFound", body);
        Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>Matches the API's own serialization: camelCase properties, camelCase string enums.</summary>
internal static class ApiJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
}
