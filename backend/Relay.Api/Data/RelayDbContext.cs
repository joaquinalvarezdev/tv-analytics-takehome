using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Relay.Api.Data;

public class RelayDbContext(DbContextOptions<RelayDbContext> options) : DbContext(options)
{
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<ActivityEvent> ActivityEvents => Set<ActivityEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // SQL Server's datetime2 has no timezone concept: every value we write and
        // read round-trips with DateTime.Kind == Unspecified. Every timestamp in
        // this schema is UTC by contract (see schema.sql), so we tag values Utc on
        // the way out of the database. We do not convert on the way in — callers
        // (entities constructed in app code, the seed importer) are responsible for
        // supplying already-UTC values; nothing in this schema is local time.
        var utcConverter = new ValueConverter<DateTime, DateTime>(
            v => v,
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

        modelBuilder.Entity<Account>(entity =>
        {
            entity.ToTable("accounts");
            entity.HasKey(a => a.Id);

            entity.Property(a => a.Id)
                .HasColumnName("id")
                .ValueGeneratedNever();

            entity.Property(a => a.Name)
                .HasColumnName("name")
                .HasMaxLength(120)
                .IsUnicode(false)
                .IsRequired();

            entity.Property(a => a.Industry)
                .HasColumnName("industry")
                .HasMaxLength(60)
                .IsUnicode(false)
                .IsRequired();

            entity.Property(a => a.Timezone)
                .HasColumnName("timezone")
                .HasMaxLength(60)
                .IsUnicode(false)
                .IsRequired();

            entity.Property(a => a.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("datetime2")
                .HasConversion(utcConverter)
                .IsRequired();
        });

        modelBuilder.Entity<ActivityEvent>(entity =>
        {
            entity.ToTable("activity_events");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id)
                .HasColumnName("id")
                .ValueGeneratedNever();

            entity.Property(e => e.AccountId)
                .HasColumnName("account_id")
                .IsRequired();

            entity.Property(e => e.Location)
                .HasColumnName("location")
                .HasMaxLength(80)
                .IsUnicode(false)
                .IsRequired();

            entity.Property(e => e.EventType)
                .HasColumnName("event_type")
                .HasMaxLength(40)
                .IsUnicode(false)
                .IsRequired();

            entity.Property(e => e.OccurredAt)
                .HasColumnName("occurred_at")
                .HasColumnType("datetime2")
                .HasConversion(utcConverter)
                .IsRequired();

            entity.Property(e => e.DurationSeconds)
                .HasColumnName("duration_seconds");

            entity.Property(e => e.Outcome)
                .HasColumnName("outcome")
                .HasMaxLength(40)
                .IsUnicode(false);

            // schema.sql declares a plain REFERENCES with no ON DELETE clause, which
            // is NO ACTION (i.e. restrict) in SQL Server. EF Core's default for a
            // required relationship is Cascade, so this is set explicitly to match
            // the schema rather than silently diverging from it.
            entity.HasOne(e => e.Account)
                .WithMany(a => a.ActivityEvents)
                .HasForeignKey(e => e.AccountId)
                .OnDelete(DeleteBehavior.Restrict);

            // Every reporting query filters by account and a UTC time range.
            entity.HasIndex(e => new { e.AccountId, e.OccurredAt });
        });
    }
}
