namespace Relay.Api.Features.WeeklySummary;

/// <summary>
/// Maps the domain's plain result records to the API's wire DTOs. Kept separate from the domain so
/// <c>Models.cs</c> stays untouched — the rename of <c>DeltaPct</c> to <c>DeltaRatio</c> happens only
/// at this boundary.
/// </summary>
internal static class WeeklySummaryMapping
{
    public static MetricComparisonResponse ToResponse(this MetricComparison m)
        => new(m.Current, m.BaselineMedian, m.DeltaPct, m.Status);

    public static TypeBreakdownResponse ToResponse(this TypeBreakdown t)
        => new(t.EventType, t.Current, t.BaselineMedian);

    public static LocationSummaryResponse ToResponse(this LocationSummary l)
        => new(l.Location, l.Total.ToResponse(), l.ByType.Select(t => t.ToResponse()).ToList());

    public static HistoricalComparisonResponse ToResponse(this BaselineWindow w)
        => new(w.WeekStart, w.ThroughDate, w.Total);

    public static WeeklySummaryResponse ToResponse(this WeeklySummaryResult r, int accountId, string timezone)
        => new(
            accountId,
            timezone,
            r.WeekStart,
            r.WeekEnd,
            r.ThroughDate,
            r.DataStatus,
            r.BaselineWeeksUsed,
            r.Totals.ToResponse(),
            r.ByType.Select(t => t.ToResponse()).ToList(),
            r.Locations.Select(l => l.ToResponse()).ToList(),
            r.ComparisonHistory.Select(w => w.ToResponse()).ToList());
}
