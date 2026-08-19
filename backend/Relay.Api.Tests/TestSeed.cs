using Relay.Api.Data;

namespace Relay.Api.Tests;

/// <summary>
/// Small hand-computable datasets for the endpoint tests. Deliberately tiny: these tests are about
/// the HTTP contract, so every expected number below is one a reader can verify by counting.
/// </summary>
internal static class TestSeed
{
    /// <summary>Monday 2026-07-27, 09:00 America/Chicago (CDT, UTC-5).</summary>
    private const int MorningUtcHour = 14;

    /// <summary>Monday 2026-07-27, 12:00 America/Chicago — the latest event, and therefore the anchor.</summary>
    private const int AnchorUtcHour = 17;

    /// <summary>The account-local Monday of the in-progress week, for both seeded accounts.</summary>
    public static readonly DateOnly CurrentWeekStart = new(2026, 7, 27);

    /// <summary>Eight complete weeks precede <see cref="CurrentWeekStart"/>, starting here.</summary>
    public static readonly DateOnly FirstBaselineWeekStart = new(2026, 6, 1);

    public const int ActiveAccountId = 1;
    public const int SilentAccountId = 2;

    /// <summary>Events counted in the in-progress week: the 12:00 anchor event is the window's exclusive end.</summary>
    public const int CurrentWeekCountedEvents = 5;

    /// <summary>Every baseline window holds two events, so the median is 2.</summary>
    public const int BaselineEventsPerWeek = 2;

    public const int BaselineWeeks = 8;

    /// <summary>
    /// One active account and one with no events at all. The active account's first event is a
    /// Monday, so its first week is fully observed and all eight preceding weeks are eligible.
    /// </summary>
    public static void Standard(RelayDbContext db)
    {
        db.Accounts.Add(NewAccount(ActiveAccountId, "Testable Motors", "America/Chicago"));
        db.Accounts.Add(NewAccount(SilentAccountId, "Quiet Harbor Spa", "America/New_York"));

        var id = 1;

        foreach (var week in Enumerable.Range(0, BaselineWeeks))
        {
            var monday = FirstBaselineWeekStart.AddDays(7 * week);
            foreach (var _ in Enumerable.Range(0, BaselineEventsPerWeek))
            {
                db.ActivityEvents.Add(NewEvent(id++, ActiveAccountId, monday, MorningUtcHour));
            }
        }

        foreach (var _ in Enumerable.Range(0, CurrentWeekCountedEvents))
        {
            db.ActivityEvents.Add(NewEvent(id++, ActiveAccountId, CurrentWeekStart, MorningUtcHour));
        }

        // The anchor event itself. Windows are half-open at the anchor's local time-of-day, so this
        // one sits exactly on the boundary and is excluded — from the reported week and from every
        // baseline window alike, which is what keeps the comparison symmetric.
        db.ActivityEvents.Add(NewEvent(id, ActiveAccountId, CurrentWeekStart, AnchorUtcHour));
    }

    /// <summary>Accounts but no events — the "dataset not loaded yet" state, where there is no anchor.</summary>
    public static void AccountsWithoutEvents(RelayDbContext db)
        => db.Accounts.Add(NewAccount(ActiveAccountId, "Testable Motors", "America/Chicago"));

    /// <summary>
    /// An account whose stored timezone is not a real IANA id, which throws deep inside the request.
    /// Stands in for any unforeseen server-side failure, to prove it surfaces as ProblemDetails.
    /// </summary>
    public static void AccountWithUnknownTimezone(RelayDbContext db)
    {
        db.Accounts.Add(NewAccount(ActiveAccountId, "Broken Data Co", "Mars/Olympus_Mons"));
        db.ActivityEvents.Add(NewEvent(1, ActiveAccountId, CurrentWeekStart, MorningUtcHour));
    }

    private static Account NewAccount(int id, string name, string timezone) => new()
    {
        Id = id,
        Name = name,
        Industry = "automotive",
        Timezone = timezone,
        CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    private static ActivityEvent NewEvent(int id, int accountId, DateOnly localDay, int utcHour) => new()
    {
        Id = id,
        AccountId = accountId,
        Location = "Main",
        EventType = "call_received",
        OccurredAt = new DateTime(localDay.Year, localDay.Month, localDay.Day, utcHour, 0, 0, DateTimeKind.Utc),
        DurationSeconds = 120,
        Outcome = "connected",
    };
}
