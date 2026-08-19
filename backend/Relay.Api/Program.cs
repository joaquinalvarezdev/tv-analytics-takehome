using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Relay.Api;
using Relay.Api.Data;
using Relay.Api.Features.WeeklySummary;

var builder = WebApplication.CreateBuilder(args);

const string DevCorsPolicy = "DevCors";

// Add services to the container.
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();

// Enums serialize as camelCase strings (e.g. "ok", "insufficientHistory") on every JSON path —
// minimal-API responses and the generated OpenAPI schema alike — so the frontend never sees raw ints.
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});

builder.Services.AddSwaggerGen(options =>
{
    options.SupportNonNullableReferenceTypes();
    options.UseInlineDefinitionsForEnums();

    // Swashbuckle's schema generator reads Microsoft.AspNetCore.Mvc.JsonOptions, which this
    // minimal-API-only app never configures, so it doesn't see the JsonStringEnumConverter registered
    // above via ConfigureHttpJsonOptions and would otherwise describe enums as raw integers even
    // though they serialize as camelCase strings at runtime. Fix the schema to match reality.
    options.SchemaFilter<StringEnumSchemaFilter>();

    // Without an explicit `required` list, every property generates as optional in the TypeScript
    // client, forcing the frontend into `?.` chains and non-null assertions on fields the API always
    // sends. Response DTOs are records whose non-nullable properties are genuinely always present.
    options.SchemaFilter<RequireNonNullablePropertiesSchemaFilter>();

    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath))
    {
        options.IncludeXmlComments(xmlPath, includeControllerXmlComments: true);
    }
});

builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("RelayDb")
        ?? throw new InvalidOperationException(
            "Connection string 'RelayDb' is not configured. Set ConnectionStrings:RelayDb " +
            "(see appsettings.Development.json for the local default).")));

builder.Services.AddScoped<WeeklySummaryRepository>();
builder.Services.AddSingleton<WeeklySummaryService>();

// Every deliberate failure in this API answers with ProblemDetails; these two lines make an
// *undeliberate* one do the same instead of returning an empty body. See UnhandledExceptionHandler.
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<UnhandledExceptionHandler>();

builder.Services.AddCors(options =>
{
    // Development-only: lets the Angular dev server (ng serve, port 4200) call the API. Production
    // CORS would be scoped to the real deployed frontend origin, not left wide open like this.
    options.AddPolicy(DevCorsPolicy, policy =>
        policy.WithOrigins("http://localhost:4200")
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var app = builder.Build();

// First in the pipeline: nothing downstream can throw past it.
app.UseExceptionHandler();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors(DevCorsPolicy);
}

app.UseHttpsRedirection();

// Apply pending migrations, then import seed.sql if the database is empty.
// SeedImporter is idempotent (skips if `accounts` already has rows), so this is
// safe to run on every startup.
//
// Set Relay:InitializeDatabaseOnStartup=false where the database is provisioned out of band —
// migrations applied by a deploy step, or an integration test supplying its own schema and rows.
if (app.Configuration.GetValue("Relay:InitializeDatabaseOnStartup", defaultValue: true))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    db.Database.Migrate();
    await SeedImporter.RunAsync(db, logger);
}

app.MapWeeklySummaryEndpoints();

app.Run();

/// <summary>
/// Named so integration tests can boot this exact application through <c>WebApplicationFactory</c>.
/// Top-level statements would otherwise compile to an inaccessible internal <c>Program</c> class.
/// </summary>
public partial class Program;

/// <summary>
/// Describes enums in the generated OpenAPI schema as string enums (camelCase, matching
/// <see cref="JsonStringEnumConverter"/> above) instead of Swashbuckle's default raw-integer schema.
/// </summary>
internal sealed class StringEnumSchemaFilter : Swashbuckle.AspNetCore.SwaggerGen.ISchemaFilter
{
    public void Apply(Microsoft.OpenApi.Models.OpenApiSchema schema, Swashbuckle.AspNetCore.SwaggerGen.SchemaFilterContext context)
    {
        if (!context.Type.IsEnum)
        {
            return;
        }

        schema.Type = "string";
        schema.Format = null;
        schema.Enum.Clear();
        foreach (var name in Enum.GetNames(context.Type))
        {
            schema.Enum.Add(new Microsoft.OpenApi.Any.OpenApiString(JsonNamingPolicy.CamelCase.ConvertName(name)));
        }
    }
}

/// <summary>
/// Marks every non-nullable property of a generated object schema as <c>required</c>, so an OpenAPI
/// client generator emits non-optional TypeScript fields for values the API always sends. Nullable
/// properties (<c>baselineMedian</c>, <c>deltaRatio</c>, <c>firstSelectableWeekStart</c>) are left
/// out of the list and stay nullable — that null carries meaning and must survive into the client.
/// </summary>
internal sealed class RequireNonNullablePropertiesSchemaFilter : Swashbuckle.AspNetCore.SwaggerGen.ISchemaFilter
{
    public void Apply(Microsoft.OpenApi.Models.OpenApiSchema schema, Swashbuckle.AspNetCore.SwaggerGen.SchemaFilterContext context)
    {
        if (schema.Properties is null || schema.Properties.Count == 0)
        {
            return;
        }

        foreach (var (name, property) in schema.Properties)
        {
            if (!property.Nullable)
            {
                schema.Required.Add(name);
            }
        }
    }
}
