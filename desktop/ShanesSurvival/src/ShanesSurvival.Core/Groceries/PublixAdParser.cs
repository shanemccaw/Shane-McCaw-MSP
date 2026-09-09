using System.Text.RegularExpressions;

namespace ShanesSurvival.Core.Groceries;

/// <summary>
/// Turns one raw card scraped off Publix's real rendered weekly-ad page (see
/// `WeeklyAdScraperWindow`'s extraction script) into the same shapes `push_deals`/`push_coupons`
/// already accept. Pure, no I/O — real, honestly unit-testable without a live WebView2 session or
/// network access, unlike the scrape itself.
///
/// Real, stated limit (Git #3288's own "honest maintenance note"): this is store-specific,
/// heuristic text parsing against whatever a real flyer happens to print. It is written
/// defensively — an unrecognized card is skipped and reported, never guessed at or silently
/// dropped — but a Publix ad-page redesign, or a genuinely novel price format, can still make it
/// misparse or skip real items. That is expected occasional upkeep, not a bug to chase to zero.
/// </summary>
public static class PublixAdParser
{
    // "2 for $5", "2/$5", "3 for $10.00" — the multi-buy shape. Checked before the plain-price
    // regex below since a plain "$5" pattern would otherwise also match inside this text.
    private static readonly Regex MultiBuyRegex = new(
        @"(?<count>\d+)\s*(?:for|/)\s*\$\s*(?<price>[\d,]+(?:\.\d{2})?)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // "$2.99", "$12" — a plain single price.
    private static readonly Regex PlainPriceRegex = new(
        @"\$\s*(?<price>[\d,]+(?:\.\d{2})?)",
        RegexOptions.Compiled);

    // "$1 off", "$1.50 off any" — a flat cents-off discount, distinct from a multi-buy.
    private static readonly Regex DollarsOffRegex = new(
        @"\$\s*(?<price>[\d,]+(?:\.\d{2})?)\s*off",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex BogoRegex = new(
        @"\bbogo\b|buy\s+one\s+get\s+one|buy\s*\d+\s*get\s*\d+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// Parses every raw card, returning what could be pushed and a real, honest list of the
    /// cards that didn't parse (with their raw text, so the run's status log shows exactly what
    /// was skipped rather than just a count).
    /// </summary>
    public static (List<ScrapedDealItem> Deals, List<ScrapedCouponItem> Coupons, List<string> Skipped) Parse(
        IEnumerable<RawAdCard> cards, string store, DateOnly? validOn = null)
    {
        var deals = new List<ScrapedDealItem>();
        var coupons = new List<ScrapedCouponItem>();
        var skipped = new List<string>();
        var validOnText = validOn?.ToString("yyyy-MM-dd");

        foreach (var card in cards)
        {
            var title = NormalizeTitle(card.Title);
            if (string.IsNullOrWhiteSpace(title))
            {
                skipped.Add($"(no title) price='{card.PriceText}' badge='{card.BadgeText}'");
                continue;
            }

            var foundDeal = false;
            var foundCoupon = false;

            var priceText = card.PriceText ?? string.Empty;
            var multiBuy = MultiBuyRegex.Match(priceText);
            if (multiBuy.Success && TryParseCents(multiBuy.Groups["price"].Value, out var multiBuyCents))
            {
                coupons.Add(new ScrapedCouponItem(
                    title,
                    priceText.Trim(),
                    MultiBuyCount: int.Parse(multiBuy.Groups["count"].Value),
                    MultiBuyPriceCents: multiBuyCents,
                    DiscountCents: null));
                foundCoupon = true;
            }
            else
            {
                // Strip "$X off" phrases before hunting for a plain sale price — otherwise a
                // coupon's discount figure (e.g. "$1.50 off any") gets misread as if $1.50 were
                // the item's actual sale price, which would push a real, false low price.
                var withoutDollarsOff = DollarsOffRegex.Replace(priceText, string.Empty);
                var plain = PlainPriceRegex.Match(withoutDollarsOff);
                if (plain.Success && TryParseCents(plain.Groups["price"].Value, out var priceCents))
                {
                    deals.Add(new ScrapedDealItem(title, priceCents, Unit: null, ValidOn: validOnText));
                    foundDeal = true;
                }
            }

            var badgeText = card.BadgeText;
            if (!string.IsNullOrWhiteSpace(badgeText))
            {
                var dollarsOff = DollarsOffRegex.Match(badgeText);
                if (dollarsOff.Success && TryParseCents(dollarsOff.Groups["price"].Value, out var discountCents))
                {
                    coupons.Add(new ScrapedCouponItem(title, badgeText.Trim(), null, null, discountCents));
                    foundCoupon = true;
                }
                else if (BogoRegex.IsMatch(badgeText))
                {
                    // BOGO has no fixed sale price to record — the real deal is "the second one is
                    // free", which push_coupons has no dedicated field for. Recorded as a plain
                    // description-only coupon rather than guessing at a multiBuy shape it doesn't
                    // actually have.
                    coupons.Add(new ScrapedCouponItem(title, badgeText.Trim(), null, null, null));
                    foundCoupon = true;
                }
            }

            if (!foundDeal && !foundCoupon)
            {
                skipped.Add($"'{title}' price='{card.PriceText}' badge='{card.BadgeText}'");
            }
        }

        return (deals, coupons, skipped);
    }

    private static string? NormalizeTitle(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        // Collapse whitespace/newlines a real rendered card's innerText often carries.
        return Regex.Replace(raw.Trim(), @"\s+", " ");
    }

    private static bool TryParseCents(string dollarsText, out int cents)
    {
        cents = 0;
        var cleaned = dollarsText.Replace(",", string.Empty);
        if (!decimal.TryParse(cleaned, System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var dollars))
        {
            return false;
        }
        cents = (int)Math.Round(dollars * 100m, MidpointRounding.AwayFromZero);
        return true;
    }
}
