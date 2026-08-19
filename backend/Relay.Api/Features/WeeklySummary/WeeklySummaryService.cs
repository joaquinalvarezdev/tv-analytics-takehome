namespace Relay.Api.Features.WeeklySummary;

/// <summary>
/// Pure domain service that turns raw activity events into a classified weekly summary: "is this
/// normal for us?" for the account overall, per event type, and per location.
/// </summary>
/// <remarks>
/// No EF, no database, no I/O, no async — everything here operates on plain in-memory records so it
/// can be unit-tested with hand-built inputs. See <see cref="ReportingCalendar"/> for the UTC/local
/// bucketing rules and <see cref="ReportingRules"/> for the tunable thresholds.
/// </remarks>
public sealed class WeeklySummaryService
{
    public WeeklySummaryResult Build(WeeklySummaryInput input)
    {
        if (input.WeekStart.DayOfWeek != DayOfWeek.Monday)
        {
            throw new ArgumentException($"WeekStart must be a Monday; got {input.WeekStart} ({input.WeekStart.DayOfWeek}).", nameof(input));
        }

        var tz = input.TimeZone;
        var weekStart = input.WeekStart;
        var weekEnd = weekStart.AddDays(6);

        if (weekStart > ReportingCalendar.CurrentWeekStart(input.AnchorUtc, tz))
        {
            throw new ArgumentException($"WeekStart {weekStart} has not started yet relative to the anchor.", nameof(input));
        }

        // The window cutoff, derived from the anchor: the whole week (dayIndex 7) for a completed
        // week, or (anchor's local day index, anchor's local time-of-day) for the in-progress week.
        // Applied identically to the reported week and every baseline week below — that symmetry is
        // what makes a partial-week comparison honest (see ReportingCalendar/PLAN for the rationale).
        var cutoff = ComputeCutoff(input.AnchorUtc, tz, weekStart);

        // Bucket every candidate event into its account-local week exactly once, up front. Events
        // outside the baseline/reported window are tolerated here and simply never looked up.
        var eventsByWeek = input.Events
            .ToLookup(e => ReportingCalendar.WeekStartOf(ReportingCalendar.ToLocalDay(e.OccurredAtUtc, tz)));

        // Events for a given local week, truncated at the shared cutoff. Used for the reported week
        // and every baseline week alike, so the comparison is always over equivalent windows.
        List<ActivityEventRecord> WindowedWeek(DateOnly w) => eventsByWeek[w]
            .Where(e => IsInWindow(e.OccurredAtUtc, tz, w, cutoff))
            .ToList();

        // The earliest local week that is *fully* observed. A week is only eligible as baseline when
        // its own Monday is on or after the account's first observed local day — otherwise the week
        // is a partial sliver (e.g. first event on a Wednesday or Sunday) whose weekly total would be
        // a structural undercount, not a legitimate "quiet week" zero. Such a week is excluded
        // entirely, not partially credited: it never becomes an eligible baseline week even though
        // some events in it are real.
        var firstEligibleWeekStart = input.FirstEventUtc is { } firstEvent
            ? FirstEligibleWeekStart(firstEvent, tz)
            : (DateOnly?)null;

        // Baseline weeks: the complete weeks immediately preceding WeekStart, closest first, at most
        // BaselineWeeks, and never earlier than the account's first fully-observed local week. An
        // account with no events at all (null FirstEventUtc) has nothing observed, so it has zero
        // eligible baseline weeks — not "everything is eligible".
        var baselineWeekStarts = firstEligibleWeekStart is null
            ? new List<DateOnly>()
            : Enumerable.Range(1, ReportingRules.BaselineWeeks)
                .Select(i => weekStart.AddDays(-7 * i))
                .Where(w => w >= firstEligibleWeekStart.Value)
                .ToList();

        var baselineWeeksUsed = baselineWeekStarts.Count;

        var dataStatus = input.FirstEventUtc is null
            ? DataStatus.NoActivity
            : baselineWeeksUsed < ReportingRules.MinimumBaselineWeeks
                ? DataStatus.InsufficientHistory
                : DataStatus.Ok;

        var reportedWeekEvents = WindowedWeek(weekStart);
        var baselineEvents = baselineWeekStarts.SelectMany(WindowedWeek).ToList();

        // ----- Account-level totals -----
        // The baseline samples are materialised once, here, and the median is then computed *from the
        // very list that is returned* as ComparisonHistory. That makes the "history shows the samples
        // the median actually used" invariant structural rather than something two code paths have to
        // agree about. Each window carries the same cutoff as the reported week, so a partial current
        // week is compared against equivalent partial historical windows.
        var comparisonHistory = baselineWeekStarts
            .Select(w => new BaselineWindow(w, ThroughDateFor(w, cutoff), WindowedWeek(w).Count))
            .ToList();
        var totalBaselineWeekly = comparisonHistory.Select(h => h.Total).ToList();
        var totals = Classify(reportedWeekEvents.Count, totalBaselineWeekly, dataStatus);

        // ----- Account-level by-type -----
        var accountTypes = OrderEventTypes(reportedWeekEvents.Select(e => e.EventType)
            .Concat(baselineEvents.Select(e => e.EventType)));
        var byType = accountTypes
            .Select(type => BuildTypeBreakdown(type, reportedWeekEvents, baselineWeekStarts, WindowedWeek, dataStatus, location: null))
            .ToList();

        // ----- Locations -----
        var locationNames = reportedWeekEvents.Select(e => e.Location)
            .Concat(baselineEvents.Select(e => e.Location))
            .Distinct(StringComparer.Ordinal);

        var locationSummaries = locationNames
            .Select(location => BuildLocationSummary(location, reportedWeekEvents, baselineWeekStarts, WindowedWeek, dataStatus))
            .ToList();

        var sortedLocations = SortLocationsWorstFirst(locationSummaries);

        return new WeeklySummaryResult(
            weekStart,
            weekEnd,
            ThroughDateFor(weekStart, cutoff),
            dataStatus,
            baselineWeeksUsed,
            totals,
            byType,
            sortedLocations,
            comparisonHistory);
    }

    private static LocationSummary BuildLocationSummary(
        string location,
        IReadOnlyList<ActivityEventRecord> reportedWeekEvents,
        IReadOnlyList<DateOnly> baselineWeekStarts,
        Func<DateOnly, List<ActivityEventRecord>> windowedWeek,
        DataStatus dataStatus)
    {
        var reportedAtLocation = reportedWeekEvents.Where(e => e.Location == location).ToList();
        var baselineAtLocation = baselineWeekStarts
            .SelectMany(w => windowedWeek(w).Where(e => e.Location == location))
            .ToList();

        var baselineWeekly = baselineWeekStarts
            .Select(w => windowedWeek(w).Count(e => e.Location == location))
            .ToList();
        var total = Classify(reportedAtLocation.Count, baselineWeekly, dataStatus);

        var types = OrderEventTypes(reportedAtLocation.Select(e => e.EventType)
            .Concat(baselineAtLocation.Select(e => e.EventType)));

        var byType = types
            .Select(type => BuildTypeBreakdown(type, reportedWeekEvents, baselineWeekStarts, windowedWeek, dataStatus, location))
            .ToList();

        return new LocationSummary(location, total, byType);
    }

    private static TypeBreakdown BuildTypeBreakdown(
        string type,
        IReadOnlyList<ActivityEventRecord> reportedWeekEvents,
        IReadOnlyList<DateOnly> baselineWeekStarts,
        Func<DateOnly, List<ActivityEventRecord>> windowedWeek,
        DataStatus dataStatus,
        string? location)
    {
        bool Matches(ActivityEventRecord e) => e.EventType == type && (location is null || e.Location == location);

        var current = reportedWeekEvents.Count(Matches);
        var baselineWeekly = baselineWeekStarts
            .Select(w => windowedWeek(w).Count(Matches))
            .ToList();

        var median = dataStatus == DataStatus.Ok ? Median(baselineWeekly) : (decimal?)null;
        return new TypeBreakdown(type, current, median);
    }

    /// <summary>
    /// Canonical event types first, in fixed order (always emitted, even at 0), then any other type
    /// alphabetically. Unknown event types still count toward totals — they are never dropped.
    /// </summary>
    private static IReadOnlyList<string> OrderEventTypes(IEnumerable<string> observedTypes)
    {
        var extras = observedTypes
            .Where(t => !ReportingRules.CanonicalEventTypes.Contains(t, StringComparer.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(t => t, StringComparer.Ordinal);

        return ReportingRules.CanonicalEventTypes.Concat(extras).ToList();
    }

    /// <summary>
    /// Classifies a current value against its baseline weekly values. Only ever produces a real
    /// verdict when <paramref name="dataStatus"/> is <see cref="DataStatus.Ok"/> — otherwise the
    /// current count is still returned raw, with a null median/delta and <see cref="ActivityStatus.NoVerdict"/>.
    /// </summary>
    private static MetricComparison Classify(int current, IReadOnlyList<int> baselineWeekly, DataStatus dataStatus)
    {
        if (dataStatus != DataStatus.Ok)
        {
            return new MetricComparison(current, null, null, ActivityStatus.NoVerdict);
        }

        var median = Median(baselineWeekly);

        // A zero baseline median means there is nothing to judge the current value against — not "no
        // activity is typical" and not "any activity is above". Report it raw, distinguishable from
        // insufficient-history (baselineMedian: 0, not null) but with no verdict.
        if (median == 0m)
        {
            return new MetricComparison(current, 0m, null, ActivityStatus.NoVerdict);
        }

        var deltaPct = (current - median) / median;
        var absDelta = Math.Abs(current - median);

        var flagged = Math.Abs(deltaPct) >= ReportingRules.DeviationThreshold && absDelta >= ReportingRules.AbsoluteFloorEvents;
        var verdict = flagged
            ? (deltaPct > 0 ? ActivityStatus.Above : ActivityStatus.Below)
            : ActivityStatus.Typical;

        return new MetricComparison(current, median, deltaPct, verdict);
    }

    /// <summary>
    /// The earliest local Monday that is fully observed given an account's first-ever event. If the
    /// first event's local day is itself a Monday, that week is fully observed and eligible. Otherwise
    /// the week containing the first event is only partially observed and the next Monday is the
    /// first eligible week.
    /// </summary>
    private static DateOnly FirstEligibleWeekStart(DateTime firstEventUtc, TimeZoneInfo tz)
    {
        var firstObservedLocalDay = ReportingCalendar.ToLocalDay(firstEventUtc, tz);
        var firstObservedWeekStart = ReportingCalendar.WeekStartOf(firstObservedLocalDay);
        return firstObservedWeekStart == firstObservedLocalDay
            ? firstObservedWeekStart
            : firstObservedWeekStart.AddDays(7);
    }

    private static decimal Median(IReadOnlyList<int> values)
    {
        var sorted = values.OrderBy(v => v).ToList();
        var n = sorted.Count;
        return n % 2 == 1
            ? sorted[n / 2]
            : (sorted[n / 2 - 1] + sorted[n / 2]) / 2m;
    }

    /// <summary>
    /// Worst-first: Below (most negative delta first), then Above (largest delta first), then
    /// Typical/NoVerdict (largest current first). Ties broken by location name for determinism.
    /// </summary>
    private static List<LocationSummary> SortLocationsWorstFirst(IReadOnlyList<LocationSummary> locations)
    {
        return locations
            .Select(l => (Summary: l, Key: SortKey(l)))
            .OrderBy(x => x.Key.Rank)
            .ThenBy(x => x.Key.Secondary)
            .ThenBy(x => x.Key.Tertiary)
            .ThenBy(x => x.Summary.Location, StringComparer.Ordinal)
            .Select(x => x.Summary)
            .ToList();
    }

    private static (int Rank, decimal Secondary, decimal Tertiary) SortKey(LocationSummary l)
    {
        var t = l.Total;
        return t.Status switch
        {
            // Below/Above only ever come from a non-zero baseline median (see Classify — a zero
            // median is NoVerdict), so DeltaPct is always set here.
            ActivityStatus.Below => (0, t.DeltaPct!.Value, 0m),
            ActivityStatus.Above => (1, -t.DeltaPct!.Value, 0m),
            _ => (2, -t.Current, 0m),
        };
    }

    /// <summary>
    /// The shared window cutoff, applied identically to the reported week and every baseline week.
    /// A completed week (<paramref name="weekStart"/> is not the in-progress current week) gets the
    /// whole week, encoded as <c>DayIndex = 7</c> so every <c>idx</c> 0..6 satisfies <c>idx &lt; 7</c>.
    /// The in-progress week is truncated at the anchor's local day and time-of-day.
    /// </summary>
    /// <summary>
    /// The last local day included in a window under <paramref name="cutoff"/> — the week's Sunday for
    /// a whole-week cutoff, otherwise the cut day. Shared by the reported week and every historical
    /// window so their displayed through-dates are produced by one rule, not two.
    /// </summary>
    private static DateOnly ThroughDateFor(DateOnly weekStart, (int DayIndex, TimeOnly TimeOfDay) cutoff)
        => weekStart.AddDays(cutoff.DayIndex >= 7 ? 6 : cutoff.DayIndex);

    private static (int DayIndex, TimeOnly TimeOfDay) ComputeCutoff(DateTime anchorUtc, TimeZoneInfo tz, DateOnly weekStart)
    {
        if (weekStart != ReportingCalendar.CurrentWeekStart(anchorUtc, tz))
        {
            return (7, TimeOnly.MinValue);
        }

        var anchorLocal = ReportingCalendar.ToLocal(anchorUtc, tz);
        var dayIndex = DateOnly.FromDateTime(anchorLocal).DayNumber - weekStart.DayNumber;
        return (dayIndex, TimeOnly.FromDateTime(anchorLocal));
    }

    /// <summary>
    /// Whether an event falls inside local week <paramref name="weekStart"/>'s window under
    /// <paramref name="cutoff"/>. Compared lexicographically on calendar (dayIndex, timeOfDay) —
    /// never on elapsed hours/<see cref="TimeSpan"/> from the week start, since a local week can be
    /// 167h or 169h across a DST transition and elapsed-time math would silently mis-bucket.
    /// </summary>
    private static bool IsInWindow(DateTime occurredAtUtc, TimeZoneInfo tz, DateOnly weekStart, (int DayIndex, TimeOnly TimeOfDay) cutoff)
    {
        var local = ReportingCalendar.ToLocal(occurredAtUtc, tz);
        var idx = DateOnly.FromDateTime(local).DayNumber - weekStart.DayNumber;

        if (idx < 0 || idx >= 7)
        {
            return false;
        }

        return idx < cutoff.DayIndex || (idx == cutoff.DayIndex && TimeOnly.FromDateTime(local) < cutoff.TimeOfDay);
    }
}
