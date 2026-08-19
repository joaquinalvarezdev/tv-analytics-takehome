using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;

namespace Relay.Api.Data;

/// <summary>
/// Idempotent importer for seed.sql. Parses the INSERT statements directly (no
/// sqlcmd dependency) rather than executing the file as raw SQL, because the
/// target ID values must be preserved verbatim (accounts and activity_events
/// have no identity/auto-increment column — see RelayDbContext) and because we
/// want a single, auditable code path for both entities.
///
/// Deliberately does NOT deduplicate. seed.sql contains 12 rows that are
/// identical except for id; PLAN.md records this as a product decision
/// (duplicates are counted as real events, since there is no natural key to
/// justify dropping them). "Cleaning" the data here would silently contradict
/// that decision.
/// </summary>
public static class SeedImporter
{
    private const string SeedFileName = "seed.sql";
    private const string TimestampFormat = "yyyy-MM-dd HH:mm:ss";

    public static async Task RunAsync(RelayDbContext db, ILogger logger, CancellationToken ct = default)
    {
        if (await db.Accounts.AnyAsync(ct))
        {
            logger.LogInformation("Seed import skipped: accounts table is already populated.");
            return;
        }

        var path = Path.Combine(AppContext.BaseDirectory, SeedFileName);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"Seed import failed: expected seed file at '{path}' but it does not exist. " +
                "Check that Relay.Api.csproj links seed.sql into the output directory.",
                path);
        }

        logger.LogInformation("Seed import starting from {Path}", path);

        var accounts = new List<Account>();
        var events = new List<ActivityEvent>();

        var lineNumber = 0;
        foreach (var rawLine in File.ReadLines(path))
        {
            lineNumber++;
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            if (line.StartsWith("INSERT INTO accounts", StringComparison.OrdinalIgnoreCase))
            {
                accounts.Add(ParseAccount(line, lineNumber));
            }
            else if (line.StartsWith("INSERT INTO activity_events", StringComparison.OrdinalIgnoreCase))
            {
                events.Add(ParseActivityEvent(line, lineNumber));
            }
            else
            {
                throw new FormatException(
                    $"Seed import failed at {SeedFileName}:{lineNumber}: unrecognized statement (expected an " +
                    $"INSERT INTO accounts/activity_events statement or a comment): '{line}'");
            }
        }

        if (accounts.Count == 0 || events.Count == 0)
        {
            throw new InvalidOperationException(
                $"Seed import failed: parsed {accounts.Count} accounts and {events.Count} activity_events from " +
                $"'{path}'. Expected both to be non-zero — the file may be truncated or malformed.");
        }

        var autoDetect = db.ChangeTracker.AutoDetectChangesEnabled;
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        try
        {
            await db.Accounts.AddRangeAsync(accounts, ct);
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();

            const int batchSize = 1000;
            for (var offset = 0; offset < events.Count; offset += batchSize)
            {
                var batch = events.Skip(offset).Take(batchSize);
                await db.ActivityEvents.AddRangeAsync(batch, ct);
                await db.SaveChangesAsync(ct);
                db.ChangeTracker.Clear();
            }
        }
        finally
        {
            db.ChangeTracker.AutoDetectChangesEnabled = autoDetect;
        }

        logger.LogInformation(
            "Seed import complete: {AccountCount} accounts, {EventCount} activity_events.",
            accounts.Count, events.Count);
    }

    private static Account ParseAccount(string line, int lineNumber)
    {
        var fields = ExtractValueFields(line, lineNumber, expectedCount: 5);
        try
        {
            return new Account
            {
                Id = ParseInt(fields[0], lineNumber),
                Name = RequireNotNull(fields[1], "name", lineNumber),
                Industry = RequireNotNull(fields[2], "industry", lineNumber),
                Timezone = RequireNotNull(fields[3], "timezone", lineNumber),
                CreatedAt = ParseUtcTimestamp(fields[4], lineNumber),
            };
        }
        catch (Exception ex) when (ex is not FormatException)
        {
            throw new FormatException($"Seed import failed at {SeedFileName}:{lineNumber}: '{line}'", ex);
        }
    }

    private static ActivityEvent ParseActivityEvent(string line, int lineNumber)
    {
        var fields = ExtractValueFields(line, lineNumber, expectedCount: 7);
        try
        {
            return new ActivityEvent
            {
                Id = ParseInt(fields[0], lineNumber),
                AccountId = ParseInt(fields[1], lineNumber),
                Location = RequireNotNull(fields[2], "location", lineNumber),
                EventType = RequireNotNull(fields[3], "event_type", lineNumber),
                OccurredAt = ParseUtcTimestamp(fields[4], lineNumber),
                DurationSeconds = fields[5] is null ? null : ParseInt(fields[5], lineNumber),
                Outcome = fields[6],
            };
        }
        catch (Exception ex) when (ex is not FormatException)
        {
            throw new FormatException($"Seed import failed at {SeedFileName}:{lineNumber}: '{line}'", ex);
        }
    }

    private static string RequireNotNull(string? value, string columnName, int lineNumber)
    {
        return value ?? throw new FormatException(
            $"Seed import failed at {SeedFileName}:{lineNumber}: column '{columnName}' is NOT NULL but parsed as NULL.");
    }

    private static int ParseInt(string? value, int lineNumber)
    {
        if (value is null || !int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
        {
            throw new FormatException($"Seed import failed at {SeedFileName}:{lineNumber}: could not parse integer '{value}'.");
        }
        return result;
    }

    private static DateTime ParseUtcTimestamp(string? value, int lineNumber)
    {
        if (value is null || !DateTime.TryParseExact(
                value, TimestampFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            throw new FormatException($"Seed import failed at {SeedFileName}:{lineNumber}: could not parse timestamp '{value}'.");
        }
        return DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
    }

    /// <summary>
    /// Extracts the comma-separated VALUES(...) fields from a single-row INSERT
    /// statement, honoring single-quoted string literals (with '' as an escaped
    /// quote) and the bare NULL keyword. A quoted field yields its unescaped
    /// string content; the bare token NULL yields null; anything else (an
    /// unquoted integer literal) is returned as its raw text for the caller to
    /// parse.
    /// </summary>
    private static List<string?> ExtractValueFields(string line, int lineNumber, int expectedCount)
    {
        const string valuesMarker = "VALUES (";
        var valuesIdx = line.IndexOf(valuesMarker, StringComparison.OrdinalIgnoreCase);
        if (valuesIdx < 0)
        {
            throw new FormatException($"Seed import failed at {SeedFileName}:{lineNumber}: missing VALUES clause: '{line}'");
        }

        var body = line[(valuesIdx + valuesMarker.Length)..].TrimEnd();
        if (body.EndsWith(");", StringComparison.Ordinal))
        {
            body = body[..^2];
        }
        else if (body.EndsWith(")", StringComparison.Ordinal))
        {
            body = body[..^1];
        }
        else
        {
            throw new FormatException($"Seed import failed at {SeedFileName}:{lineNumber}: statement does not end with ');': '{line}'");
        }

        var fields = new List<string?>();
        var current = new StringBuilder();
        var inQuotes = false;
        var quoted = false;

        for (var i = 0; i < body.Length; i++)
        {
            var c = body[i];
            if (inQuotes)
            {
                if (c == '\'')
                {
                    if (i + 1 < body.Length && body[i + 1] == '\'')
                    {
                        current.Append('\'');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    current.Append(c);
                }
            }
            else if (c == '\'')
            {
                inQuotes = true;
                quoted = true;
            }
            else if (c == ',')
            {
                fields.Add(FinishField(current, quoted));
                current.Clear();
                quoted = false;
            }
            else if (char.IsWhiteSpace(c) && !quoted && current.Length == 0)
            {
                // Skip leading whitespace before a field's content begins (the
                // space after a comma in ", 'value'" or ", 123"). Anything inside
                // quotes is handled by the inQuotes branch above and never reaches
                // here.
            }
            else
            {
                current.Append(c);
            }
        }

        if (inQuotes)
        {
            throw new FormatException($"Seed import failed at {SeedFileName}:{lineNumber}: unterminated string literal: '{line}'");
        }

        fields.Add(FinishField(current, quoted));

        if (fields.Count != expectedCount)
        {
            throw new FormatException(
                $"Seed import failed at {SeedFileName}:{lineNumber}: expected {expectedCount} values, got {fields.Count}: '{line}'");
        }

        return fields;
    }

    private static string? FinishField(StringBuilder current, bool quoted)
    {
        var text = current.ToString().Trim();
        if (!quoted && string.Equals(text, "NULL", StringComparison.Ordinal))
        {
            return null;
        }
        return quoted ? current.ToString() : text;
    }
}
