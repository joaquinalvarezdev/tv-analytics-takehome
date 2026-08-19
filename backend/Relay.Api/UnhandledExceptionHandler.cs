using Microsoft.AspNetCore.Diagnostics;

namespace Relay.Api;

/// <summary>
/// Turns any unhandled exception into a logged <c>application/problem+json</c> 500, so an unexpected
/// failure is shaped like every deliberate error path (<c>400</c>/<c>404</c>/<c>503</c>) instead of
/// falling out of the pipeline as an empty response body the SPA cannot describe to the user.
/// </summary>
/// <remarks>
/// The response deliberately carries no exception detail — message, type and stack trace go to the
/// log, never to the client. Callers get a stable shape; operators get the diagnosis.
/// </remarks>
internal sealed class UnhandledExceptionHandler(
    IProblemDetailsService problemDetailsService,
    ILogger<UnhandledExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        // A malformed request — e.g. `?weekStart=last-monday`, which minimal-API parameter binding
        // rejects — arrives here as a BadHttpRequestException carrying its own 4xx status. That is
        // the caller's mistake, not a server failure: it must not be logged as an error, and must
        // not be flattened into a 500. Without this branch, adding a catch-all handler silently
        // regresses every binding failure from 400 to 500.
        if (exception is BadHttpRequestException badRequest)
        {
            logger.LogWarning(
                "Rejected malformed request {Method} {Path}: {Reason}",
                httpContext.Request.Method,
                httpContext.Request.Path,
                badRequest.Message);

            httpContext.Response.StatusCode = badRequest.StatusCode;

            return await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = httpContext,
                ProblemDetails =
                {
                    Status = badRequest.StatusCode,
                    Title = "Invalid request",

                    // Names the offending parameter and value — that is the API's own documented
                    // surface, and it is what makes the 400 actionable instead of an empty body.
                    Detail = badRequest.Message,
                },
            });
        }

        logger.LogError(
            exception,
            "Unhandled exception handling {Method} {Path}",
            httpContext.Request.Method,
            httpContext.Request.Path);

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;

        return await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails =
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "Unexpected error",
                Detail = "The request could not be completed. The failure has been logged.",
            },
        });
    }
}
