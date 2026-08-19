using Microsoft.EntityFrameworkCore;
using Relay.Api.Data;

namespace Relay.Api.Features.WeeklySummary;

/// <summary>
/// Focused data-access boundary over <see cref="RelayDbContext"/> for the weekly-summary feature.
/// No generic repository framework — just the handful of queries this feature needs.
/// </summary>
public sealed class WeeklySummaryRepository(RelayDbContext db)
{
    public async Task<IReadOnlyList<Account>> GetAccountsAsync(CancellationToken ct)
        => await db.Accounts
            .AsNoTracking()
            .OrderBy(a => a.Id)
            .ToListAsync(ct);

    public async Task<Account?> GetAccountAsync(int id, CancellationToken ct)
        => await db.Accounts
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == id, ct);

    /// <summary>Dataset-wide MAX(occurred_at); null when the table is empty (e.g. dataset not loaded).</summary>
    public async Task<DateTime?> GetAnchorUtcAsync(CancellationToken ct)
    {
        if (!await db.ActivityEvents.AnyAsync(ct))
        {
            return null;
        }

        return await db.ActivityEvents.MaxAsync(e => e.OccurredAt, ct);
    }

    /// <summary>One GROUP BY query for every account's first event — avoids N+1 on the accounts list.</summary>
    public async Task<IReadOnlyDictionary<int, DateTime>> GetFirstEventUtcByAccountAsync(CancellationToken ct)
        => await db.ActivityEvents
            .AsNoTracking()
            .GroupBy(e => e.AccountId)
            .Select(g => new { AccountId = g.Key, FirstEventUtc = g.Min(e => e.OccurredAt) })
            .ToDictionaryAsync(x => x.AccountId, x => x.FirstEventUtc, ct);

    public async Task<DateTime?> GetFirstEventUtcAsync(int accountId, CancellationToken ct)
    {
        var events = db.ActivityEvents.Where(e => e.AccountId == accountId);
        return await events.AnyAsync(ct)
            ? await events.MinAsync(e => e.OccurredAt, ct)
            : null;
    }

    public async Task<IReadOnlyList<ActivityEventRecord>> GetEventsAsync(
        int accountId, DateTime fromUtc, DateTime toUtcExclusive, CancellationToken ct)
        => await db.ActivityEvents
            .AsNoTracking()
            .Where(e => e.AccountId == accountId && e.OccurredAt >= fromUtc && e.OccurredAt < toUtcExclusive)
            .Select(e => new ActivityEventRecord(e.Location, e.EventType, e.OccurredAt))
            .ToListAsync(ct);
}
