using Relay.Api.Features.WeeklySummary;

namespace Relay.Api.Tests.Features.WeeklySummary;

public class WeeklySummaryServiceTests
{
    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

    // Far earlier than any test's baseline window, so BaselineWeeksUsed is never trimmed by it
    // unless a test deliberately picks a later FirstEventUtc to exercise that trimming.
    private static readonly DateTime EarlyFirstEvent = new(2020, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void ThresholdAndFloor_FourToThree_NotFlagged()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        var events = BaselineAndCurrent(weekStart, "Main", "call_received", currentCount: 3, baselineCounts: Enumerable.Repeat(4, 8).ToArray());

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, EarlyFirstEvent));

        Assert.Equal(DataStatus.Ok, result.DataStatus);
        Assert.Equal(3, result.Totals.Current);
        Assert.Equal(4m, result.Totals.BaselineMedian);
        Assert.Equal(-0.25m, result.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.Typical, result.Totals.Status); // fails the absolute-floor (|3-4|=1 < 3)
    }

    [Fact]
    public void ThresholdAndFloor_FortyToTwentyEight_FlaggedBelow()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        var events = BaselineAndCurrent(weekStart, "Main", "call_received", currentCount: 28, baselineCounts: Enumerable.Repeat(40, 8).ToArray());

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, EarlyFirstEvent));

        Assert.Equal(40m, result.Totals.BaselineMedian);
        Assert.Equal(-0.3m, result.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.Below, result.Totals.Status); // clears both the % threshold and the floor
    }

    [Fact]
    public void ZeroBaseline_ReturnsNoVerdict_NotAFabricatedTier()
    {
        // Deleted product-invented tiers (median==0 -> Above/Typical by the absolute floor) removed:
        // a zero baseline is "nothing to compare against", not "typical" or "above normal".
        var weekStart = new DateOnly(2026, 6, 1);
        var events = BaselineAndCurrent(weekStart, "Main", "call_received", currentCount: 3, baselineCounts: Enumerable.Repeat(0, 8).ToArray());

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, EarlyFirstEvent));

        Assert.Equal(3, result.Totals.Current);
        Assert.Equal(0m, result.Totals.BaselineMedian);
        Assert.Null(result.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.NoVerdict, result.Totals.Status);
    }

    [Fact]
    public void InsufficientHistory_FewerThanFourBaselineWeeks_ReturnsRawCountsWithNoVerdict()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        // Account's first-ever event falls exactly on the Monday of the week starting weekStart-14,
        // so that week is fully observed and eligible; only 2 complete baseline weeks precede the
        // reported week.
        var firstEventUtc = LocalInstantUtc(weekStart.AddDays(-14), new TimeOnly(9, 0), Chicago);
        var events = BaselineAndCurrent(weekStart, "Main", "call_received", currentCount: 5, baselineCounts: new[] { 6, 7 });

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, firstEventUtc));

        Assert.Equal(DataStatus.InsufficientHistory, result.DataStatus);
        Assert.Equal(2, result.BaselineWeeksUsed);
        Assert.Equal(5, result.Totals.Current);
        Assert.Null(result.Totals.BaselineMedian);
        Assert.Null(result.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.NoVerdict, result.Totals.Status);

        var location = Assert.Single(result.Locations);
        Assert.Equal("Main", location.Location);
        Assert.Equal(5, location.Total.Current);
        Assert.Equal(ActivityStatus.NoVerdict, location.Total.Status);
    }

    [Fact]
    public void NoActivity_AccountWithNoEvents_ReturnsNoActivityAndEmptyLocations()
    {
        var weekStart = new DateOnly(2026, 6, 1);

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, Array.Empty<ActivityEventRecord>(), firstEventUtc: null));

        Assert.Equal(DataStatus.NoActivity, result.DataStatus);
        Assert.Equal(0, result.BaselineWeeksUsed);
        Assert.Equal(0, result.Totals.Current);
        Assert.Null(result.Totals.BaselineMedian);
        Assert.Null(result.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.NoVerdict, result.Totals.Status);
        Assert.Empty(result.Locations);
        Assert.Equal(weekStart, result.WeekStart);
        Assert.Equal(weekStart.AddDays(6), result.WeekEnd);
    }

    [Fact]
    public void DuplicateEvents_AreCountedTwice_NoDeduplication()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        var instant = MidWeekUtc(weekStart, Chicago);

        var events = new List<ActivityEventRecord>
        {
            new("Main", "call_received", instant),
            new("Main", "call_received", instant), // exact duplicate: same location, type, and instant
        };
        events.AddRange(BaselineAndCurrent(weekStart, "Main", "call_received", currentCount: 0, baselineCounts: Enumerable.Repeat(5, 8).ToArray()));

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, EarlyFirstEvent));

        Assert.Equal(2, result.Totals.Current);
        Assert.Equal(2, result.Locations.Single().Total.Current);
    }

    [Fact]
    public void BurstWeek_InBaseline_DoesNotMoveMedian_ButAsReportedWeek_IsAbove()
    {
        var reportedWeek = new DateOnly(2026, 6, 1);
        var burstWeek = reportedWeek.AddDays(-21); // the 3rd preceding week

        // Scenario A: the burst sits inside the baseline. Median robustness keeps it at the normal 10.
        var baselineWithBurst = new[] { 10, 10, 100, 10, 10, 10, 10, 10 };
        var scenarioAEvents = BaselineAndCurrent(reportedWeek, "Downtown", "call_received", currentCount: 10, baselineCounts: baselineWithBurst);
        var scenarioA = new WeeklySummaryService().Build(MakeInput(reportedWeek, scenarioAEvents, EarlyFirstEvent));

        Assert.Equal(10m, scenarioA.Totals.BaselineMedian);
        Assert.Equal(0m, scenarioA.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.Typical, scenarioA.Totals.Status);

        // Scenario B: the same burst week is now the *reported* week, with a clean baseline behind it.
        var scenarioBEvents = BaselineAndCurrent(burstWeek, "Downtown", "call_received", currentCount: 100, baselineCounts: Enumerable.Repeat(10, 8).ToArray());
        var scenarioB = new WeeklySummaryService().Build(MakeInput(burstWeek, scenarioBEvents, EarlyFirstEvent));

        Assert.Equal(10m, scenarioB.Totals.BaselineMedian);
        Assert.Equal(9m, scenarioB.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.Above, scenarioB.Totals.Status);
    }

    [Fact]
    public void LocationBusyInBaseline_ButAbsentThisWeek_StillAppears_WithZeroCurrentAndBelowVerdict()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        var events = BaselineAndCurrent(weekStart, "Southside", "call_received", currentCount: 0, baselineCounts: Enumerable.Repeat(10, 8).ToArray());

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, EarlyFirstEvent));

        var location = Assert.Single(result.Locations);
        Assert.Equal("Southside", location.Location);
        Assert.Equal(0, location.Total.Current);
        Assert.Equal(10m, location.Total.BaselineMedian);
        Assert.Equal(-1m, location.Total.DeltaPct);
        Assert.Equal(ActivityStatus.Below, location.Total.Status);
    }

    [Fact]
    public void AccountLevelBaseline_IsNotSumOfPerLocationMedians()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        // First event exactly on the Monday of weekStart-28, so that week is fully observed and
        // eligible, trimming the baseline to exactly the 4 weeks weekStart-7..weekStart-28.
        var firstEventUtc = LocalInstantUtc(weekStart.AddDays(-28), new TimeOnly(9, 0), Chicago);

        // Weekly totals across baseline weeks -7,-14,-21,-28: [10, 0, 10, 0] -> median 5.
        // Per-location weekly counts: A = [0,0,10,0] -> median 0; B = [10,0,0,0] -> median 0.
        // Sum of per-location medians (0) must NOT equal the account-level median (5) — the account
        // baseline is computed from account-wide weekly totals, not by summing location medians.
        var events = new List<ActivityEventRecord>();
        events.AddRange(WeekOf(weekStart.AddDays(-7), "A", "call_received", 0));
        events.AddRange(WeekOf(weekStart.AddDays(-7), "B", "call_received", 10));
        events.AddRange(WeekOf(weekStart.AddDays(-14), "A", "call_received", 0));
        events.AddRange(WeekOf(weekStart.AddDays(-14), "B", "call_received", 0));
        events.AddRange(WeekOf(weekStart.AddDays(-21), "A", "call_received", 10));
        events.AddRange(WeekOf(weekStart.AddDays(-21), "B", "call_received", 0));
        events.AddRange(WeekOf(weekStart.AddDays(-28), "A", "call_received", 0));
        events.AddRange(WeekOf(weekStart.AddDays(-28), "B", "call_received", 0));

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, firstEventUtc));

        Assert.Equal(4, result.BaselineWeeksUsed);
        Assert.Equal(5m, result.Totals.BaselineMedian);

        var locationA = result.Locations.Single(l => l.Location == "A");
        var locationB = result.Locations.Single(l => l.Location == "B");
        Assert.Equal(0m, locationA.Total.BaselineMedian);
        Assert.Equal(0m, locationB.Total.BaselineMedian);

        Assert.NotEqual(result.Totals.BaselineMedian, locationA.Total.BaselineMedian + locationB.Total.BaselineMedian);
    }

    [Fact]
    public void InProgressWeek_ComparesEquivalentTruncatedWindows_NotFullBaselineWeeks()
    {
        // The reported week is the in-progress current week, cut mid-week by the anchor (Wednesday
        // 12:00 local). Every baseline week must be truncated to the *same* Mon-Wed-noon window, not
        // counted in full — otherwise a full-week baseline would misrepresent a partial current week.
        var weekStart = new DateOnly(2026, 6, 1);
        var anchorUtc = LocalInstantUtc(weekStart.AddDays(2), new TimeOnly(12, 0), Chicago); // Wed noon local

        // First event exactly on the Monday of weekStart-28, so exactly the 4 weeks weekStart-7..
        // weekStart-28 are eligible baseline weeks — no unpopulated fifth-through-eighth week to
        // silently drag the median down with structural zeros.
        var firstEventUtc = LocalInstantUtc(weekStart.AddDays(-28), new TimeOnly(9, 0), Chicago);

        var events = new List<ActivityEventRecord>();
        // Reported (in-progress) week: 4 events before the Wed-noon cutoff.
        events.AddRange(Enumerable.Repeat(
            new ActivityEventRecord("Main", "call_received", LocalInstantUtc(weekStart, new TimeOnly(9, 0), Chicago)), 4));

        // Each baseline week has 4 events before the equivalent Wed-noon cutoff, plus 6 more events
        // later in the week (Thu-Sun) that must be EXCLUDED from the baseline median. If the service
        // wrongly compared against full baseline weeks, the median would be 10, not 4.
        for (var i = 1; i <= 4; i++)
        {
            var baselineWeekStart = weekStart.AddDays(-7 * i);
            events.AddRange(Enumerable.Repeat(
                new ActivityEventRecord("Main", "call_received", LocalInstantUtc(baselineWeekStart, new TimeOnly(9, 0), Chicago)), 4));
            events.AddRange(Enumerable.Repeat(
                new ActivityEventRecord("Main", "call_received", LocalInstantUtc(baselineWeekStart.AddDays(3), new TimeOnly(9, 0), Chicago)), 6));
        }

        var input = new WeeklySummaryInput(Chicago, weekStart, anchorUtc, firstEventUtc, events);
        var result = new WeeklySummaryService().Build(input);

        Assert.Equal(DataStatus.Ok, result.DataStatus);
        Assert.Equal(4, result.Totals.Current);
        Assert.Equal(4m, result.Totals.BaselineMedian); // NOT 10m
        Assert.Equal(0m, result.Totals.DeltaPct);
        Assert.Equal(ActivityStatus.Typical, result.Totals.Status);
    }

    [Fact]
    public void InProgressWeek_TruncatesBaselineWeekEventsByTimeOfDay_NotJustByDate()
    {
        // The dataset anchor is a specific local time, not just a date. A baseline-week event on the
        // *cutoff day itself* but AFTER the cutoff time must be excluded. A date-only (not
        // date+time) comparison would wrongly include it, inflating every baseline — the precise
        // 6.6%-average / 16.1%-worst-case Monday bias this change exists to prevent.
        var weekStart = new DateOnly(2026, 6, 1);
        var anchorUtc = LocalInstantUtc(weekStart, new TimeOnly(15, 20), Chicago); // Monday 15:20 local

        // First event exactly on the Monday of weekStart-28, bounding eligible baseline weeks to
        // exactly weekStart-7..weekStart-28 (same reasoning as the test above).
        var firstEventUtc = LocalInstantUtc(weekStart.AddDays(-28), new TimeOnly(9, 0), Chicago);

        var events = new List<ActivityEventRecord>
        {
            // Reported week: one event before the cutoff time on the cutoff day.
            new("Main", "call_received", LocalInstantUtc(weekStart, new TimeOnly(9, 0), Chicago)),
        };

        for (var i = 1; i <= 4; i++)
        {
            var baselineWeekStart = weekStart.AddDays(-7 * i);
            // Before the cutoff time on the cutoff day (Monday) -> included.
            events.Add(new ActivityEventRecord("Main", "call_received", LocalInstantUtc(baselineWeekStart, new TimeOnly(9, 0), Chicago)));
            // After the cutoff time on the SAME cutoff day (Monday) -> must be excluded.
            events.Add(new ActivityEventRecord("Main", "call_received", LocalInstantUtc(baselineWeekStart, new TimeOnly(18, 0), Chicago)));
        }

        var input = new WeeklySummaryInput(Chicago, weekStart, anchorUtc, firstEventUtc, events);
        var result = new WeeklySummaryService().Build(input);

        Assert.Equal(DataStatus.Ok, result.DataStatus);
        Assert.Equal(1, result.Totals.Current);
        // If only the date (not the time) were compared, both events on each baseline Monday would be
        // counted, giving a median of 2m instead of 1m.
        Assert.Equal(1m, result.Totals.BaselineMedian);
    }

    [Fact]
    public void CompletedWeek_IncludesEveryEvent_AndThroughDateIsWeekEnd()
    {
        // Same fixture as the truncation test above, but reported as a completed week (anchor far in
        // the future relative to it) — every event counts, including the post-cutoff-time ones.
        var weekStart = new DateOnly(2026, 6, 1);
        var farFutureAnchorUtc = MidWeekUtc(weekStart.AddDays(90), Chicago);

        var events = new List<ActivityEventRecord>
        {
            new("Main", "call_received", LocalInstantUtc(weekStart, new TimeOnly(9, 0), Chicago)),
            new("Main", "call_received", LocalInstantUtc(weekStart, new TimeOnly(18, 0), Chicago)),
        };

        var input = new WeeklySummaryInput(Chicago, weekStart, farFutureAnchorUtc, EarlyFirstEvent, events);
        var result = new WeeklySummaryService().Build(input);

        Assert.Equal(2, result.Totals.Current);
        Assert.Equal(result.WeekEnd, result.ThroughDate);
        Assert.Equal(weekStart.AddDays(6), result.ThroughDate);
    }

    [Fact]
    public void ThroughDate_IsAnchorLocalDay_ForInProgressWeek()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        var anchorUtc = LocalInstantUtc(weekStart.AddDays(2), new TimeOnly(12, 0), Chicago); // Wed local

        var input = new WeeklySummaryInput(Chicago, weekStart, anchorUtc, EarlyFirstEvent, Array.Empty<ActivityEventRecord>());
        var result = new WeeklySummaryService().Build(input);

        Assert.Equal(weekStart.AddDays(2), result.ThroughDate);
    }

    [Fact]
    public void DstSpringForwardWeek_PartialWindow_BucketsCorrectly()
    {
        // 2026-03-02 .. 2026-03-09 is the 167h spring-forward week (transition 2026-03-08 02:00 ->
        // 03:00 local). Report it in-progress with an anchor on the Sunday after the transition, and
        // confirm the cutoff bucketing is unaffected by the shortened week — this is the regression
        // guard against rewriting IsInWindow as elapsed-time-from-week-start math.
        var weekStart = new DateOnly(2026, 3, 2);
        var anchorUtc = LocalInstantUtc(new DateOnly(2026, 3, 8), new TimeOnly(10, 0), Chicago); // Sun 10:00 CDT, post-transition

        var events = new List<ActivityEventRecord>
        {
            // Monday (before the DST jump) -> included (idx 0 < cutoff dayIndex 6).
            new("Main", "call_received", LocalInstantUtc(new DateOnly(2026, 3, 2), new TimeOnly(9, 0), Chicago)),
            // Cutoff day (Sunday, idx 6) before the cutoff time -> included.
            new("Main", "call_received", LocalInstantUtc(new DateOnly(2026, 3, 8), new TimeOnly(9, 0), Chicago)),
            // Cutoff day (Sunday, idx 6) after the cutoff time -> excluded.
            new("Main", "call_received", LocalInstantUtc(new DateOnly(2026, 3, 8), new TimeOnly(11, 0), Chicago)),
        };

        var input = new WeeklySummaryInput(Chicago, weekStart, anchorUtc, EarlyFirstEvent, events);
        var result = new WeeklySummaryService().Build(input);

        Assert.Equal(2, result.Totals.Current);
        Assert.Equal(new DateOnly(2026, 3, 8), result.ThroughDate);
    }

    [Fact]
    public void FutureWeekStart_ThrowsArgumentException()
    {
        var anchorUtc = LocalInstantUtc(new DateOnly(2026, 6, 1), new TimeOnly(12, 0), Chicago);
        var futureWeekStart = ReportingCalendar.CurrentWeekStart(anchorUtc, Chicago).AddDays(7);

        var input = new WeeklySummaryInput(Chicago, futureWeekStart, anchorUtc, EarlyFirstEvent, Array.Empty<ActivityEventRecord>());

        Assert.Throws<ArgumentException>(() => new WeeklySummaryService().Build(input));
    }

    [Fact]
    public void ByType_AlwaysEmitsCanonicalTypesInOrder_EvenAtZero()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        var events = BaselineAndCurrent(weekStart, "Main", "call_received", currentCount: 5, baselineCounts: Enumerable.Repeat(5, 8).ToArray());

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, EarlyFirstEvent));

        Assert.Equal(new[] { "call_received", "lead_created", "appointment_set" }, result.ByType.Select(t => t.EventType));
        Assert.Equal(5, result.ByType.Single(t => t.EventType == "call_received").Current);
        Assert.Equal(0, result.ByType.Single(t => t.EventType == "lead_created").Current);
        Assert.Equal(0, result.ByType.Single(t => t.EventType == "appointment_set").Current);
    }

    // ---- "eligible baseline week" tests (orchestrator correction: a week is only baseline-eligible
    // when it is *fully* observed — its own Monday must be on or after the first event's local day.
    // A week partially observed because the first event fell mid-week is excluded entirely, not
    // partially credited.) ----

    [Fact]
    public void FirstEvent_OnLocalWednesday_ExcludesTheWeekContainingIt()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        // First event is Wednesday of the week starting 2026-05-11 (weekStart - 21) — a partial week.
        var firstEventUtc = MidWeekUtc(weekStart.AddDays(-21), Chicago);

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, Array.Empty<ActivityEventRecord>(), firstEventUtc));

        // Only the two weeks after the partial week (weekStart-7, weekStart-14) are eligible; the
        // partially-observed week (weekStart-21) and everything before it are excluded entirely.
        Assert.Equal(2, result.BaselineWeeksUsed);
        Assert.Equal(DataStatus.InsufficientHistory, result.DataStatus);
    }

    [Fact]
    public void FirstEvent_OnLocalMonday_IncludesTheWeekContainingIt()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        // Same target week as the Wednesday test above, but the first event is exactly on that
        // week's Monday — the week is fully observed and therefore eligible.
        var firstEventUtc = LocalInstantUtc(weekStart.AddDays(-21), new TimeOnly(10, 0), Chicago);

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, Array.Empty<ActivityEventRecord>(), firstEventUtc));

        Assert.Equal(3, result.BaselineWeeksUsed);
    }

    [Fact]
    public void FirstEvent_OnLocalSunday_ExcludesThePrecedingMondaysWeek()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        // First event is Sunday of the week starting 2026-05-11 (weekStart - 21) — this is the real
        // seed-data shape (accounts 1, 4, 5, 6, 7, 12, 14, 18 all first appear on a Sunday).
        var sundayOfPartialWeek = weekStart.AddDays(-21).AddDays(6);
        var firstEventUtc = LocalInstantUtc(sundayOfPartialWeek, new TimeOnly(12, 0), Chicago);

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, Array.Empty<ActivityEventRecord>(), firstEventUtc));

        // Same result as the Wednesday case: the week starting weekStart-21 is excluded because its
        // own Monday was never observed, even though five sixths of it (Tue-Sun) has real data.
        Assert.Equal(2, result.BaselineWeeksUsed);
    }

    [Fact]
    public void GateFlip_FirstEventSundayFeb1_ReportedWeekFeb23_IsInsufficientHistoryNotOk()
    {
        // Regression guard for the orchestrator's mid-implementation correction. Under the original
        // (wrong) rule, the partial week starting Mon 2026-01-26 counted as a full baseline week,
        // pushing this account to exactly 4 eligible weeks -> DataStatus.Ok, with a real verdict
        // computed partly from a one-day week. Under the corrected rule it must be excluded, leaving
        // only 3 eligible weeks (Feb 2, Feb 9, Feb 16) -> InsufficientHistory, no verdict.
        var weekStart = new DateOnly(2026, 2, 23);
        var firstEventUtc = new DateTime(2026, 2, 1, 18, 0, 0, DateTimeKind.Utc); // Sun 2026-02-01, 12:00 local (CST)

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, Array.Empty<ActivityEventRecord>(), firstEventUtc));

        Assert.Equal(3, result.BaselineWeeksUsed);
        Assert.Equal(DataStatus.InsufficientHistory, result.DataStatus);
        Assert.Equal(ActivityStatus.NoVerdict, result.Totals.Status);
    }

    [Fact]
    public void ObservedButEmptyBaselineWeeks_StillCountTowardBaselineAndMedian()
    {
        var weekStart = new DateOnly(2026, 6, 1);
        // First event lands exactly on the Monday of weekStart-28, so all 4 preceding weeks are
        // fully observed and eligible, including the two that happen to have zero events.
        var firstEventUtc = LocalInstantUtc(weekStart.AddDays(-28), new TimeOnly(9, 0), Chicago);

        // weekStart-7 = 10, weekStart-14 = 10, weekStart-21 = 0, weekStart-28 = 0.
        var events = BaselineAndCurrent(weekStart, "Main", "call_received", currentCount: 5, baselineCounts: new[] { 10, 10, 0, 0 });

        var result = new WeeklySummaryService().Build(MakeInput(weekStart, events, firstEventUtc));

        // If the two empty weeks were wrongly dropped instead of counted as legitimate zeros, this
        // would report BaselineWeeksUsed == 2 and BaselineMedian == 10 (median of [10, 10]) instead.
        Assert.Equal(4, result.BaselineWeeksUsed);
        Assert.Equal(DataStatus.Ok, result.DataStatus);
        Assert.Equal(5m, result.Totals.BaselineMedian); // median of [10, 10, 0, 0]
    }

    // ---- test helpers ----

    /// <remarks>
    /// Chicago-only by design: the event-building helpers below place events at Chicago local noon,
    /// so accepting a time zone here would silently build events in the wrong zone. Time-zone
    /// behaviour is covered directly in <see cref="ReportingCalendarTests"/>; a service test needing
    /// another zone should construct its <see cref="WeeklySummaryInput"/> explicitly.
    /// </remarks>
    private static WeeklySummaryInput MakeInput(
        DateOnly weekStart, IReadOnlyList<ActivityEventRecord> events, DateTime? firstEventUtc)
    {
        var anchorUtc = MidWeekUtc(weekStart.AddDays(90), Chicago); // far from any week under test; irrelevant to classification
        return new WeeklySummaryInput(Chicago, weekStart, anchorUtc, firstEventUtc, events);
    }

    private static List<ActivityEventRecord> BaselineAndCurrent(
        DateOnly weekStart, string location, string eventType, int currentCount, IReadOnlyList<int> baselineCounts)
    {
        var events = new List<ActivityEventRecord>();
        events.AddRange(WeekOf(weekStart, location, eventType, currentCount));
        for (var i = 0; i < baselineCounts.Count; i++)
        {
            events.AddRange(WeekOf(weekStart.AddDays(-7 * (i + 1)), location, eventType, baselineCounts[i]));
        }

        return events;
    }

    /// <summary>Adds <paramref name="count"/> events, all at local Wednesday noon of the given week.</summary>
    private static List<ActivityEventRecord> WeekOf(DateOnly weekStart, string location, string eventType, int count)
    {
        var instant = MidWeekUtc(weekStart, Chicago);
        return Enumerable.Repeat(new ActivityEventRecord(location, eventType, instant), count).ToList();
    }

    private static DateTime MidWeekUtc(DateOnly weekStart, TimeZoneInfo tz)
        => LocalInstantUtc(weekStart.AddDays(2), new TimeOnly(12, 0), tz); // Wednesday, local noon

    private static DateTime LocalInstantUtc(DateOnly localDay, TimeOnly localTime, TimeZoneInfo tz)
    {
        var local = DateTime.SpecifyKind(localDay.ToDateTime(localTime), DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(local, tz);
    }
}
