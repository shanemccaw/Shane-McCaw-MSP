namespace ShanesSurvival.Core.Groceries;

/// <summary>
/// One real priced item read off a store's rendered weekly-ad page — shape matches shanes-life's
/// own `push_deals` MCP tool argument (web/shanes-life/src/mcp/tools.mjs) exactly, so nothing is
/// re-modeled between extraction and the pipeline that already exists for manual entry.
/// </summary>
public sealed record ScrapedDealItem(string ItemText, int PriceCents, string? Unit, string? ValidOn);

/// <summary>
/// One real coupon / multi-buy deal read off the same page — shape matches `push_coupons`.
/// Exactly one of (MultiBuyCount + MultiBuyPriceCents) or DiscountCents is normally set,
/// mirroring how a real flyer prints either "2 for $5" or "$1 off" for a given item, never both.
/// </summary>
public sealed record ScrapedCouponItem(
    string ItemText,
    string Description,
    int? MultiBuyCount,
    int? MultiBuyPriceCents,
    int? DiscountCents);

/// <summary>
/// One raw card as read straight off the rendered DOM, before any price/badge parsing —
/// <see cref="PublixAdParser"/>'s real input. Kept separate from the parsed models above so a
/// layout change that breaks parsing still leaves the raw extraction visible for debugging,
/// instead of silently vanishing into a failed regex match.
/// </summary>
public sealed record RawAdCard(string? Title, string? PriceText, string? BadgeText);

/// <summary>Real, honest result of one scrape+push run — what was found and what actually landed.</summary>
public sealed record WeeklyAdScrapeResult(
    string Store,
    int CardsSeen,
    IReadOnlyList<ScrapedDealItem> DealsPushed,
    IReadOnlyList<ScrapedCouponItem> CouponsPushed,
    IReadOnlyList<string> Skipped);
