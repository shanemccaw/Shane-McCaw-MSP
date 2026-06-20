import { logger } from "./logger";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export function graphCredentialsPresent(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET
  );
}

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const tenantId = process.env.GRAPH_TENANT_ID!;
  const clientId = process.env.GRAPH_CLIENT_ID!;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET!;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token fetch failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

export interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  } | null;
}

export async function getMailMessage(userId: string, messageId: string): Promise<GraphMessage | null> {
  try {
    const res = await graphFetch(`/users/${userId}/messages/${messageId}?$select=id,subject,bodyPreview,receivedDateTime,from`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, "Graph getMailMessage failed");
      return null;
    }
    return await res.json() as GraphMessage;
  } catch (err) {
    logger.error({ err }, "Graph getMailMessage error");
    return null;
  }
}

export interface GraphMessageBody {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  } | null;
  toRecipients: Array<{
    emailAddress: { name: string; address: string };
  }>;
  body: {
    contentType: "html" | "text";
    content: string;
  } | null;
}

export async function getMailMessageBody(userId: string, messageId: string): Promise<GraphMessageBody | null> {
  try {
    const res = await graphFetch(
      `/users/${userId}/messages/${messageId}?$select=id,subject,bodyPreview,receivedDateTime,from,toRecipients,body`
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, "Graph getMailMessageBody failed");
      return null;
    }
    return await res.json() as GraphMessageBody;
  } catch (err) {
    logger.error({ err }, "Graph getMailMessageBody error");
    return null;
  }
}

export interface GraphSubscription {
  id: string;
  expirationDateTime: string;
  resource: string;
}

export async function createSubscription(webhookUrl: string, mailUserId: string): Promise<GraphSubscription | null> {
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000);

  try {
    const res = await graphFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created",
        notificationUrl: webhookUrl,
        resource: `users/${mailUserId}/mailFolders/inbox/messages`,
        expirationDateTime: expiresAt.toISOString(),
        clientState: process.env.GRAPH_WEBHOOK_CLIENT_STATE ?? "graph-webhook-secret",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, "Graph createSubscription failed");
      return null;
    }
    return await res.json() as GraphSubscription;
  } catch (err) {
    logger.error({ err }, "Graph createSubscription error");
    return null;
  }
}

export async function renewSubscription(subscriptionId: string): Promise<GraphSubscription | null> {
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000);

  try {
    const res = await graphFetch(`/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, "Graph renewSubscription failed");
      return null;
    }
    return await res.json() as GraphSubscription;
  } catch (err) {
    logger.error({ err }, "Graph renewSubscription error");
    return null;
  }
}

export async function listSubscriptions(): Promise<GraphSubscription[]> {
  try {
    const res = await graphFetch("/subscriptions");
    if (!res.ok) return [];
    const data = await res.json() as { value: GraphSubscription[] };
    return data.value ?? [];
  } catch {
    return [];
  }
}
