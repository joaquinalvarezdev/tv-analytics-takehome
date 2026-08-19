namespace Relay.Api.Features.WeeklySummary;

/// <summary>
/// Pure calendar math for the weekly-summary feature: UTC instant → account-local day/week.
/// </summary>
/// <remarks>
/// Bucketing rule (correctness-critical): an event belongs to the account-local calendar day of its
/// UTC instant. We convert UTC → local with <see cref="TimeZoneInfo.ConvertTimeFromUtc"/> and take
/// the date. We deliberately do NOT compute local-midnight → UTC boundaries and compare instants —
/// that path is where DST bugs live (a local week can be 167h or 169h long around a DST transition,
/// and boundary-instant math silently gets that wrong).
/// </remarks>
public static class ReportingCalendar
{
    /// <summary>Converts a UTC instant to the account-local wall-clock <see cref="DateTime"/>.</summary>
    public static DateTime ToLocal(DateTime utcInstant, TimeZoneInfo tz)
    {
        var utc = DateTime.SpecifyKind(utcInstant, DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTimeFromUtc(utc, tz);
    }

    /// <summary>Converts a UTC instant to the account-local calendar day.</summary>
    public static DateOnly ToLocalDay(DateTime utcInstant, TimeZoneInfo tz)
        => DateOnly.FromDateTime(ToLocal(utcInstant, tz));

    /// <summary>Returns the Monday of the local week containing <paramref name="localDay"/>.</summary>
    public static DateOnly WeekStartOf(DateOnly localDay)
    {
        // DayOfWeek: Sunday=0 .. Saturday=6. Days since Monday, treating Sunday as 6 days past Monday.
        var daysSinceMonday = ((int)localDay.DayOfWeek + 6) % 7;
        return localDay.AddDays(-daysSinceMonday);
    }

    /// <summary>The local week start containing the anchor instant — the "current" (in-progress) week.</summary>
    public static DateOnly CurrentWeekStart(DateTime anchorUtc, TimeZoneInfo tz)
        => WeekStartOf(ToLocalDay(anchorUtc, tz));

    /// <summary>The local week start immediately preceding the current week — the last complete week.</summary>
    public static DateOnly LastCompleteWeekStart(DateTime anchorUtc, TimeZoneInfo tz)
        => CurrentWeekStart(anchorUtc, tz).AddDays(-7);

    /// <summary>
    /// A UTC range suitable for bounding a SQL query for local days in
    /// [<paramref name="localStartInclusive"/>, <paramref name="localEndExclusive"/>).
    /// </summary>
    /// <remarks>
    /// This is deliberately widened by one calendar day on each side to safely cover any UTC offset
    /// (including DST transitions) without needing to reason about exact boundary instants here. It is
    /// a query bound only — the caller (service) must re-filter precisely by local day using
    /// <see cref="ToLocalDay"/>; this range is intentionally over-inclusive, never under-inclusive.
    /// </remarks>
    public static (DateTime FromUtcInclusive, DateTime ToUtcExclusive) UtcQueryRange(
        DateOnly localStartInclusive, DateOnly localEndExclusive, TimeZoneInfo tz)
    {
        var widenedStart = localStartInclusive.AddDays(-1);
        var widenedEnd = localEndExclusive.AddDays(1);

        var fromUtc = LocalMidnightToUtc(widenedStart, tz);
        var toUtc = LocalMidnightToUtc(widenedEnd, tz);
        return (fromUtc, toUtc);
    }

    private static DateTime LocalMidnightToUtc(DateOnly localDay, TimeZoneInfo tz)
    {
        var local = DateTime.SpecifyKind(localDay.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified);

        // Local midnight essentially never falls inside a DST spring-forward gap, but guard anyway
        // since this is only a widened query bound and correctness elsewhere never depends on it.
        if (tz.IsInvalidTime(local))
        {
            local = local.AddHours(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(local, tz);
    }
}
