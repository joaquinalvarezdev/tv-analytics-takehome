namespace Relay.Api.Features.WeeklySummary;

/// <summary>
/// A single raw activity event, as it would come off the events table (or a test fixture).
/// <paramref name="OccurredAtUtc"/> must be a UTC instant.
/// </summary>
public sealed record ActivityEventRecord(string Location, string EventType, DateTime OccurredAtUtc);

/// <summary>
/// Input to <see cref="WeeklySummaryService.Build"/>. Pure data — no EF, no I/O.
/// </summary>
/// <param name="TimeZone">The account's IANA time zone.</param>
/// <param name="WeekStart">The Monday (account-local) of the week being reported on.</param>
/// <param name="AnchorUtc">The dataset-wide MAX(occurred_at), treated as "now".</param>
/// <param name="FirstEventUtc">
/// The account's earliest event across all time, or null if the account has no events at all.
/// </param>
/// <param name="Events">
/// Candidate events for this account. May contain events outside the baseline/reported window —
/// the service filters precisely by local week itself.
/// </param>
public sealed record WeeklySummaryInput(
    TimeZoneInfo TimeZone,
    DateOnly WeekStart,
    DateTime AnchorUtc,
    DateTime? FirstEventUtc,
    IReadOnlyList<ActivityEventRecord> Events);

public enum ActivityStatus
{
    Below,
    Typical,
    Above,
    NoVerdict,
}

public enum DataStatus
{
    Ok,
    InsufficientHistory,
    NoActivity,
}

/// <summary>
/// Current-week value for a metric compared against its baseline median.
/// <see cref="Status"/> is <see cref="ActivityStatus.NoVerdict"/> in two distinct cases, both with a
/// null <see cref="DeltaPct"/>: (1) whenever the account-level <see cref="DataStatus"/> is not
/// <see cref="DataStatus.Ok"/> — here <see cref="BaselineMedian"/> is also null, since no baseline was
/// computable at all; (2) when <see cref="DataStatus"/> is <see cref="DataStatus.Ok"/> but this
/// specific metric's baseline median is genuinely zero — here <see cref="BaselineMedian"/> is <c>0m</c>
/// (not null), since a baseline exists, it's just zero, and there is nothing to compare the current
/// value's magnitude against.
/// </summary>
public sealed record MetricComparison(int Current, decimal? BaselineMedian, decimal? DeltaPct, ActivityStatus Status);

/// <summary>
/// Current vs baseline detail for a single event type. Carries no independent status — see
/// <see cref="LocationSummary"/> remarks.
/// </summary>
public sealed record TypeBreakdown(string EventType, int Current, decimal? BaselineMedian);

/// <summary>
/// Per-location activity. <see cref="Total"/> carries the location's verdict; <see cref="ByType"/>
/// rows are current-vs-median detail only, with no independent status by design (per-type statuses
/// would be noise at this sparsity).
/// </summary>
public sealed record LocationSummary(string Location, MetricComparison Total, IReadOnlyList<TypeBreakdown> ByType);

/// <summary>
/// One historical window behind the baseline median, exposed so a reader can inspect the samples
/// rather than take the median on trust.
/// </summary>
/// <remarks>
/// These are the <em>exact</em> values the median was computed from — the same window list and the
/// same cutoff — not an independent recomputation. A window with no events appears explicitly as
/// <see cref="Total"/> <c>0</c>, because an observed-but-quiet week is a legitimate sample and
/// dropping it would bias the median upward.
/// </remarks>
/// <param name="ThroughDate">
/// The last local day included in this historical window. For an in-progress reported week this is
/// the equivalent elapsed cut, not the window's Sunday — a partial current week is never compared
/// against full historical weeks.
/// </param>
public sealed record BaselineWindow(DateOnly WeekStart, DateOnly ThroughDate, int Total);

/// <param name="ThroughDate">
/// The last local day included in the comparison window, as a human-friendly display value —
/// <c>WeekEnd</c> for a completed week, or the anchor's local day for the in-progress week. This is
/// deliberately a display value only: the precise cutoff (day index + local time-of-day) used to
/// truncate baseline weeks for an honest apples-to-apples comparison is owned by the domain and not
/// exposed, because no consumer needs the minute and exposing it would invite callers to reimplement
/// window math.
/// </param>
/// <param name="ComparisonHistory">
/// The account-level historical windows behind <see cref="Totals"/>'s baseline median, most recent
/// first. Populated with whatever windows are eligible even when <see cref="DataStatus"/> is not
/// <see cref="DataStatus.Ok"/> (showing the one or two windows that do exist is more honest than
/// showing nothing); empty when the account has no observed history at all.
/// </param>
public sealed record WeeklySummaryResult(
    DateOnly WeekStart,
    DateOnly WeekEnd,
    DateOnly ThroughDate,
    DataStatus DataStatus,
    int BaselineWeeksUsed,
    MetricComparison Totals,
    IReadOnlyList<TypeBreakdown> ByType,
    IReadOnlyList<LocationSummary> Locations,
    IReadOnlyList<BaselineWindow> ComparisonHistory);
