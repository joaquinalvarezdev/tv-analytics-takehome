namespace Relay.Api.Features.WeeklySummary;

/// <summary>
/// One account, as surfaced by the demo account picker.
/// </summary>
/// <param name="CurrentWeekStart">
/// The Monday (account-local) of the in-progress week — the dashboard's default selection.
/// </param>
/// <param name="FirstSelectableWeekStart">
/// The local week of the account's first-ever event, or null when the account has no activity at all
/// (e.g. a freshly onboarded account) — nothing before this week is meaningful to select.
/// </param>
public sealed record AccountResponse(
    int Id,
    string Name,
    string Timezone,
    DateOnly CurrentWeekStart,
    DateOnly? FirstSelectableWeekStart);

/// <summary>
/// A current value compared against its trailing baseline median.
/// </summary>
/// <param name="BaselineMedian">
/// Null means no baseline was computable at all (see the parent response's <c>dataStatus</c>). Zero
/// means a baseline exists and is genuinely zero — there is nothing to compare magnitude against, so
/// <paramref name="Status"/> is <see cref="ActivityStatus.NoVerdict"/> in that case too. These two null
/// cases are intentionally distinguishable — do not collapse them.
/// </param>
/// <param name="DeltaRatio">
/// A fraction, not a percentage: 0.25 means +25%. Null whenever <see cref="Status"/> is
/// <see cref="ActivityStatus.NoVerdict"/>.
/// </param>
public sealed record MetricComparisonResponse(
    int Current,
    decimal? BaselineMedian,
    decimal? DeltaRatio,
    ActivityStatus Status);

/// <summary>Current-vs-baseline detail for a single event type. Carries no independent status.</summary>
public sealed record TypeBreakdownResponse(string EventType, int Current, decimal? BaselineMedian);

/// <summary>Per-location activity; <see cref="Total"/> carries the location's verdict.</summary>
public sealed record LocationSummaryResponse(
    string Location,
    MetricComparisonResponse Total,
    IReadOnlyList<TypeBreakdownResponse> ByType);

/// <summary>
/// One historical window behind the baseline median, so a reader can inspect the samples instead of
/// taking the median on trust. These are the exact values the median was computed from, and a quiet
/// window appears explicitly as <c>0</c> rather than being omitted.
/// </summary>
/// <param name="ThroughDate">
/// The last local day in this historical window. When the reported week is still in progress this is
/// the equivalent elapsed cut, so a partial current week is never compared against full past weeks.
/// </param>
public sealed record HistoricalComparisonResponse(DateOnly WeekStart, DateOnly ThroughDate, int Total);

/// <summary>
/// The classified weekly summary for one account and one week.
/// </summary>
/// <param name="ThroughDate">
/// The last local day included in the comparison window, as a human-facing display value —
/// <c>WeekEnd</c> for a completed week, or the anchor's local day for the in-progress week (in which
/// case <c>ThroughDate &lt; WeekEnd</c>, which is how a caller knows the week is still in progress).
/// This is deliberately a display value only: the precise cutoff (day index plus local time-of-day)
/// used to truncate baseline weeks for an honest apples-to-apples comparison stays inside the domain
/// and is not exposed — no consumer needs the minute, and exposing it would invite the frontend to
/// reimplement window math.
/// </param>
/// <param name="Locations">Already sorted worst-first by the domain.</param>
/// <param name="ComparisonHistory">
/// The windows behind <c>totals.baselineMedian</c>, most recent first. Recomputing a median over
/// these totals reproduces <c>totals.baselineMedian</c> exactly.
/// </param>
public sealed record WeeklySummaryResponse(
    int AccountId,
    string Timezone,
    DateOnly WeekStart,
    DateOnly WeekEnd,
    DateOnly ThroughDate,
    DataStatus DataStatus,
    int BaselineWeeksUsed,
    MetricComparisonResponse Totals,
    IReadOnlyList<TypeBreakdownResponse> ByType,
    IReadOnlyList<LocationSummaryResponse> Locations,
    IReadOnlyList<HistoricalComparisonResponse> ComparisonHistory);
