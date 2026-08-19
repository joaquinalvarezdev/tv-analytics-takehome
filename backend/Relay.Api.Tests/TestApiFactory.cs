using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Relay.Api.Data;

namespace Relay.Api.Tests;

/// <summary>
/// Boots the real <c>Program.cs</c> pipeline — routing, JSON options, validation, the exception
/// handler — over an in-memory SQLite database seeded by the caller.
/// </summary>
/// <remarks>
/// SQLite rather than the EF in-memory provider because it is a real relational database: the schema
/// is created from the same model the SQL Server migration is generated from, and the repository's
/// queries have to translate. It is not SQL Server, so this is not the place to verify provider-level
/// SQL behaviour — these tests exist to cover the HTTP contract (status codes, defaults, error shapes)
/// that the domain unit tests structurally cannot see.
/// </remarks>
public class TestApiFactory(Action<RelayDbContext> seed) : WebApplicationFactory<Program>
{
    private readonly SqliteConnection connection = new("Filename=:memory:");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Startup normally migrates SQL Server and imports seed.sql; this test supplies its own
        // schema and rows, so that path is switched off rather than pointed at a database that
        // isn't there.
        builder.UseSetting("Relay:InitializeDatabaseOnStartup", "false");
        builder.UseSetting("ConnectionStrings:RelayDb", "unused-the-sqlite-registration-below-wins");

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<RelayDbContext>>();
            services.RemoveAll<DbContextOptions>();
            services.RemoveAll<RelayDbContext>();

            // An in-memory SQLite database lives exactly as long as its connection, so this one is
            // opened here and held open for the factory's lifetime.
            connection.Open();
            services.AddDbContext<RelayDbContext>(options => options.UseSqlite(connection));
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);

        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
        db.Database.EnsureCreated();
        seed(db);
        db.SaveChanges();

        return host;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (disposing)
        {
            connection.Dispose();
        }
    }
}

/// <summary>The <see cref="TestSeed.Standard"/> dataset, shared by every test that doesn't need its own.</summary>
public sealed class StandardApiFactory() : TestApiFactory(TestSeed.Standard);
