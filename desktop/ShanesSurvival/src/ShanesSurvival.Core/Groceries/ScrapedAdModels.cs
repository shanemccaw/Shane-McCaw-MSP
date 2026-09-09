namespace ShanesSurvival.Core.Groceries;

/// <summary>
/// One real priced item read off a store's rendered weekly-ad page — shape matches shanes-life's
/// own `push_deals` MCP tool argument (web/shanes-life/src/mcp/tools.mjs) exactly, so nothing is
/// re-modeled between extraction and the pipeline that already exists for manual entry.
/// `ImageUrl` (Git #3310) is the real product thumbnail read off the same `img[alt]` element the
/// parser already reads the title from — genuinely present in Publix's real card DOM. `Category`
/// is deliberately NOT carried here: this pass found no per-card category grouping in Publix's
/// real rendered DOM (not live-verified — no interactive browser session available in that
/// build), so it isn't fabricated at the scraper layer; `category`/`dealType` exist on the
/// push_deals/push_coupons pipeline for Claude's own conversational reads and any future store
/// whose ad page does expose one.
/// </summary>
public sealed record ScrapedDealItem(string ItemText, int PriceCents, string? Unit, string? ValidOn, string? ImageUrl = null);

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
    int? DiscountCents,
    string? ImageUrl = null);

/// <summary>
/// One raw card as read straight off the rendered DOM, before any price/badge parsing —
/// <see cref="PublixAdParser"/>'s real input. Kept separate from the parsed models above so a
/// layout change that breaks parsing still leaves the raw extraction visible for debugging,
/// instead of silently vanishing into a failed regex match. `ImageUrl` is the card's real
/// `img[alt]` element's own `src` (Git #3310) — the same element already used for `Title`.
/// </summary>
public sealed record RawAdCard(string? Title, string? PriceText, string? BadgeText, string? ImageUrl = null);

/// <summary>Real, honest result of one scrape+push run — what was found and what actually landed.</summary>
public sealed record WeeklyAdScrapeResult(
    string Store,
    int CardsSeen,
    IReadOnlyList<ScrapedDealItem> DealsPushed,
    IReadOnlyList<ScrapedCouponItem> CouponsPushed,
    IReadOnlyList<string> Skipped);
