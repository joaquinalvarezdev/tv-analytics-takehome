namespace Relay.Api.Features.WeeklySummary;

/// <summary>
/// Tunable product constants for weekly-summary classification. Centralized here so they can be
/// revisited with real product/AM input without touching the classification logic itself.
/// </summary>
public static class ReportingRules
{
    /// <summary>Trailing complete weeks considered for the baseline, at most.</summary>
    public const int BaselineWeeks = 8;

    /// <summary>Minimum trailing complete weeks of baseline required before a verdict is given.</summary>
    public const int MinimumBaselineWeeks = 4;

    /// <summary>Minimum |Δ| as a fraction of the baseline median to flag above/below.</summary>
    public const decimal DeviationThreshold = 0.25m;

    /// <summary>Minimum absolute event-count difference from the baseline median to flag above/below.</summary>
    public const int AbsoluteFloorEvents = 3;

    /// <summary>Event types the product tracks explicitly; always emitted in this order, even at 0.</summary>
    public static readonly IReadOnlyList<string> CanonicalEventTypes = new[]
    {
        "call_received",
        "lead_created",
        "appointment_set",
    };
}
