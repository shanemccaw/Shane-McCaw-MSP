/**
 * news-fetcher.ts
 *
 * Fetches Microsoft 365 / cloud news headlines.
 * Primary:  NewsAPI.org /v2/everything (requires NEWS_API_KEY secret).
 * Fallback: Microsoft public RSS feeds parsed from XML — no auth required.
 */

import { logger } from "./logger.js";

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  description: string;
}

// ── Default AI prompts ─────────────────────────────────────────────────────────

export const DEFAULT_NEWS_PROMPT = `You are Shane McCaw, a 30-year Microsoft ecosystem veteran and Lead Microsoft 365 Architect. Review the following news headlines fetched today and identify the single hottest story for an M365 consulting audience.

Evaluate each story on:
- Client impact: how directly does it affect Microsoft 365 end users or IT decision makers?
- Recency and urgency: breaking news scores higher than evergreen
- Relevance to Shane's services: Microsoft 365, Copilot AI, SharePoint, Power Platform, Azure, Microsoft Viva, Project Online

Return ONLY a JSON object (no prose, no markdown fences) with these keys:
{
  "topic": "Short phrase naming the hottest story (10 words or fewer)",
  "context": "2–3 sentences explaining why this story matters to M365 clients and IT leaders",
  "articleSuggestion": "One paragraph blog lead-in Shane could publish — compelling opening, practitioner angle, ends with a hook",
  "hotScore": <integer 0–100>,
  "targetSector": "<one of: Government | Healthcare | Financial Services | Education | Non-Profit | Enterprise>"
}`;

export const CAMPAIGN_BRIEF_PROMPT = `You are a marketing strategist supporting Shane McCaw Consulting. Given the following news topic, context, and target sector, create a focused campaign brief.

Return ONLY a JSON object (no prose, no markdown fences) with these keys:
{
  "audience": "Precise description of who to target (job title, org size, industry)",
  "hook": "One powerful sentence that grabs attention — the campaign's core message",
  "angles": [
    "Content angle 1 (for LinkedIn post or ad)",
    "Content angle 2 (for email subject line)",
    "Content angle 3 (for short video or webinar title)"
  ]
}`;

// ── RSS feed list (fallback) ───────────────────────────────────────────────────

const FALLBACK_FEEDS = [
  {
    name: "Microsoft 365 Blog",
    url: "https://www.microsoft.com/en-us/microsoft-365/blog/feed/",
  },
  {
    name: "Power Platform Blog",
    url: "https://powerplatform.microsoft.com/en-us/blog/feed/",
  },
  {
    name: "Microsoft Tech Community",
    url: "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/rss-board-thread?board.id=Microsoft365&size=20",
  },
];

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractXmlText(xml: string, tag: string): string {
  // Double-escape required: in a JS string \s → s, so we write \\s so the
  // RegExp constructor receives the correct \s character-class shorthand.
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function parseRssItems(xml: string, sourceName: string, maxResults: number): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null && items.length < maxResults) {
    const block = match[1];
    const title = extractXmlText(block, "title").replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
    const link  = extractXmlText(block, "link").trim() || extractXmlText(block, "guid").trim();
    const pub   = extractXmlText(block, "pubDate").trim();
    const desc  = extractXmlText(block, "description").replace(/<[^>]+>/g, "").trim().slice(0, 300);
    if (title && link) {
      items.push({
        title,
        source: sourceName,
        url: link,
        publishedAt: pub || new Date().toISOString(),
        description: desc,
      });
    }
  }
  return items;
}

// ── NewsAPI fetch ─────────────────────────────────────────────────────────────

async function fetchViaNewsApi(topics: string[], maxResults: number): Promise<NewsItem[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  const query = topics.join(" OR ");
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=${Math.min(maxResults, 100)}&language=en`;

  const resp = await fetch(url, { headers: { "X-Api-Key": apiKey } });
  if (!resp.ok) {
    logger.warn({ status: resp.status }, "news-fetcher: NewsAPI returned non-200");
    return [];
  }

  const json = (await resp.json()) as {
    status: string;
    articles?: Array<{
      title: string;
      source?: { name?: string };
      url: string;
      publishedAt: string;
      description?: string;
    }>;
  };

  if (json.status !== "ok" || !Array.isArray(json.articles)) return [];

  return json.articles.slice(0, maxResults).map(a => ({
    title: a.title ?? "",
    source: a.source?.name ?? "NewsAPI",
    url: a.url ?? "",
    publishedAt: a.publishedAt ?? new Date().toISOString(),
    description: (a.description ?? "").slice(0, 300),
  }));
}

// ── RSS fallback fetch ────────────────────────────────────────────────────────

async function fetchViaRss(maxResults: number): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  const perFeed = Math.max(Math.ceil(maxResults / FALLBACK_FEEDS.length), 5);

  for (const feed of FALLBACK_FEEDS) {
    try {
      const resp = await fetch(feed.url, {
        headers: { "Accept": "application/rss+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const parsed = parseRssItems(xml, feed.name, perFeed);
      items.push(...parsed);
    } catch (err) {
      logger.warn({ err, feedUrl: feed.url }, "news-fetcher: RSS feed fetch error (skipped)");
    }
    if (items.length >= maxResults) break;
  }

  return items.slice(0, maxResults);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchNewsHeadlines(
  topics: string[],
  maxResults: number,
): Promise<NewsItem[]> {
  const effectiveTopics = topics.length > 0 ? topics : ["Microsoft 365", "Copilot AI", "SharePoint", "Power Platform", "Azure"];
  const effectiveMax = Math.max(1, Math.min(maxResults, 50));

  if (process.env.NEWS_API_KEY) {
    try {
      const items = await fetchViaNewsApi(effectiveTopics, effectiveMax);
      if (items.length > 0) {
        logger.info({ count: items.length }, "news-fetcher: fetched via NewsAPI");
        return items;
      }
    } catch (err) {
      logger.warn({ err }, "news-fetcher: NewsAPI fetch failed, falling back to RSS");
    }
  } else {
    logger.info("news-fetcher: NEWS_API_KEY absent — using RSS fallback");
  }

  const rssItems = await fetchViaRss(effectiveMax);
  logger.info({ count: rssItems.length }, "news-fetcher: fetched via RSS fallback");
  return rssItems;
}
