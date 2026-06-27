import jwt from "jsonwebtoken";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
}

export interface SearchConsoleEntry {
  query: string;
  position: number;
  clicks: number;
  impressions: number;
  url?: string;
}

async function getAccessToken(serviceAccount: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const token = jwt.sign(payload, serviceAccount.private_key, {
    algorithm: "RS256",
    keyid: serviceAccount.private_key_id,
  });

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: token,
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to get Google access token: ${resp.status} ${text}`);
  }

  const data = await resp.json() as TokenResponse;
  return data.access_token;
}

export async function fetchTopQueries(
  siteUrl: string,
  daysBack = 28,
  rowLimit = 100
): Promise<SearchConsoleEntry[]> {
  const keyJson = process.env["GOOGLE_SEARCH_CONSOLE_KEY_JSON"];
  if (!keyJson) {
    throw new Error("GOOGLE_SEARCH_CONSOLE_KEY_JSON environment variable is not set");
  }

  let serviceAccount: ServiceAccountKey;
  try {
    serviceAccount = JSON.parse(keyJson) as ServiceAccountKey;
  } catch {
    throw new Error("GOOGLE_SEARCH_CONSOLE_KEY_JSON is not valid JSON");
  }

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("GOOGLE_SEARCH_CONSOLE_KEY_JSON is missing client_email or private_key");
  }

  const accessToken = await getAccessToken(serviceAccount);

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const encodedSite = encodeURIComponent(siteUrl);
  const apiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;

  const reqBody = {
    startDate: fmt(startDate),
    endDate: fmt(endDate),
    dimensions: ["query"],
    rowLimit,
  };

  const apiResp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reqBody),
  });

  if (!apiResp.ok) {
    const text = await apiResp.text();
    throw new Error(`Search Console API error: ${apiResp.status} ${text}`);
  }

  const data = await apiResp.json() as SearchAnalyticsResponse;

  return (data.rows ?? []).map(row => ({
    query: row.keys[0] ?? "",
    position: Math.round(row.position),
    clicks: row.clicks,
    impressions: row.impressions,
  }));
}
