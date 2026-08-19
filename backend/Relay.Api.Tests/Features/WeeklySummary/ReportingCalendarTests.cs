using Relay.Api.Features.WeeklySummary;

namespace Relay.Api.Tests.Features.WeeklySummary;

public class ReportingCalendarTests
{
    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
    private static readonly TimeZoneInfo Phoenix = TimeZoneInfo.FindSystemTimeZoneById("America/Phoenix");
    private static readonly TimeZoneInfo Utc = TimeZoneInfo.FindSystemTimeZoneById("UTC");

    [Fact]
    public void EarlyMorningUtcEvent_LandsOnPreviousChicagoLocalDay()
    {
        // 2026-02-02 is a Monday. Chicago is CST (UTC-6) in early February, so 02:00 UTC is
        // 2026-02-01 20:00 local — the previous (Sunday) local day.
        var utcInstant = new DateTime(2026, 2, 2, 2, 0, 0, DateTimeKind.Utc);

        var localDay = ReportingCalendar.ToLocalDay(utcInstant, Chicago);

        Assert.Equal(new DateOnly(2026, 2, 1), localDay);
    }

    [Fact]
    public void EarlyMorningMondayUtcEvent_FallsInThePreviousChicagoLocalWeek()
    {
        // Same instant as above: local day is Sunday 2026-02-01, so the local *week* is the one
        // starting Monday 2026-01-26, not the week containing the UTC calendar Monday.
        var utcInstant = new DateTime(2026, 2, 2, 2, 0, 0, DateTimeKind.Utc);

        var localDay = ReportingCalendar.ToLocalDay(utcInstant, Chicago);
        var weekStart = ReportingCalendar.WeekStartOf(localDay);

        Assert.Equal(new DateOnly(2026, 1, 26), weekStart);
    }

    [Fact]
    public void WeekBoundary_MondayMidnightLocalInclusive_NextMondayExclusive()
    {
        // Chicago is CST (UTC-6) throughout early February 2026 (no DST in play).
        // Local Monday 2026-02-02 00:00:00 == 2026-02-02 06:00:00 UTC.
        var justBeforeBoundaryUtc = new DateTime(2026, 2, 2, 5, 59, 59, DateTimeKind.Utc);
        var exactlyAtBoundaryUtc = new DateTime(2026, 2, 2, 6, 0, 0, DateTimeKind.Utc);

        var beforeWeekStart = ReportingCalendar.WeekStartOf(ReportingCalendar.ToLocalDay(justBeforeBoundaryUtc, Chicago));
        var atWeekStart = ReportingCalendar.WeekStartOf(ReportingCalendar.ToLocalDay(exactlyAtBoundaryUtc, Chicago));

        Assert.Equal(new DateOnly(2026, 1, 26), beforeWeekStart); // still previous week (Sunday 23:59:59 local)
        Assert.Equal(new DateOnly(2026, 2, 2), atWeekStart);      // new week starts exactly at local midnight
    }

    [Fact]
    public void DstSpringForwardWeek_2026_03_02_BucketsEventsCorrectlyOnBothSides()
    {
        // US spring-forward is 2026-03-08 02:00 -> 03:00 local (CST UTC-6 -> CDT UTC-5).
        // The local week [2026-03-02, 2026-03-09) is 167 hours long, not 168, because it loses
        // that hour. Sanity-check the premise first...
        var weekStartUtc = TimeZoneInfo.ConvertTimeToUtc(new DateTime(2026, 3, 2, 0, 0, 0), Chicago);
        var nextWeekStartUtc = TimeZoneInfo.ConvertTimeToUtc(new DateTime(2026, 3, 9, 0, 0, 0), Chicago);
        Assert.Equal(167, (nextWeekStartUtc - weekStartUtc).TotalHours);

        // ...then confirm event bucketing is correct on both sides of the transition despite the
        // UTC offset changing mid-week.
        var mondayStartUtc = new DateTime(2026, 3, 2, 6, 0, 0, DateTimeKind.Utc);       // Mon 00:00 CST
        var sundayJustAfterDstUtc = new DateTime(2026, 3, 8, 8, 0, 1, DateTimeKind.Utc); // Sun 03:00:01 CDT
        var nextMondayStartUtc = new DateTime(2026, 3, 9, 5, 0, 0, DateTimeKind.Utc);    // next Mon 00:00 CDT

        Assert.Equal(new DateOnly(2026, 3, 2), ReportingCalendar.WeekStartOf(ReportingCalendar.ToLocalDay(mondayStartUtc, Chicago)));
        Assert.Equal(new DateOnly(2026, 3, 2), ReportingCalendar.WeekStartOf(ReportingCalendar.ToLocalDay(sundayJustAfterDstUtc, Chicago)));
        Assert.Equal(new DateOnly(2026, 3, 9), ReportingCalendar.WeekStartOf(ReportingCalendar.ToLocalDay(nextMondayStartUtc, Chicago)));
    }

    [Fact]
    public void AnchorDerivation_DiffersByTimeZone_IncludingNoDstZone()
    {
        // 2026-07-27 is a Monday. At 02:20 UTC it is still Sunday in both Chicago (CDT, UTC-5) and
        // Phoenix (UTC-7, no DST ever), but already Monday in UTC itself.
        var anchorUtc = new DateTime(2026, 7, 27, 2, 20, 0, DateTimeKind.Utc);

        var chicagoCurrent = ReportingCalendar.CurrentWeekStart(anchorUtc, Chicago);
        var phoenixCurrent = ReportingCalendar.CurrentWeekStart(anchorUtc, Phoenix);
        var utcCurrent = ReportingCalendar.CurrentWeekStart(anchorUtc, Utc);

        Assert.Equal(new DateOnly(2026, 7, 20), chicagoCurrent); // Sunday local -> previous week
        Assert.Equal(new DateOnly(2026, 7, 20), phoenixCurrent); // no-DST zone, same conclusion
        Assert.Equal(new DateOnly(2026, 7, 27), utcCurrent);     // already Monday in UTC

        Assert.Equal(new DateOnly(2026, 7, 13), ReportingCalendar.LastCompleteWeekStart(anchorUtc, Chicago));
        Assert.Equal(new DateOnly(2026, 7, 13), ReportingCalendar.LastCompleteWeekStart(anchorUtc, Phoenix));
        Assert.Equal(new DateOnly(2026, 7, 20), ReportingCalendar.LastCompleteWeekStart(anchorUtc, Utc));

        // This derivation depends only on the anchor and time zone, never on whether the account has
        // any events — it is exactly as valid for a zero-activity account.
    }
}
