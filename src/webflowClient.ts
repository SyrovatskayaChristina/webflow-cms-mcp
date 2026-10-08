/**
 * Minimal typed client for the Webflow Data API (v2) — just the endpoints
 * this MCP server needs. Kept separate from index.ts so the HTTP/auth
 * concerns don't leak into tool-definition code.
 *
 * Docs: https://developers.webflow.com/data/reference/rest-introduction
 * (Verify endpoint shapes against the current docs before relying on this
 * in production — the Webflow API does evolve.)
 */

const WEBFLOW_API_BASE = "https://api.webflow.com/v2";

export class WebflowApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown
  ) {
    super(`Webflow API error ${status} ${statusText}: ${JSON.stringify(body)}`);
    this.name = "WebflowApiError";
  }
}

export interface WebflowField {
  id: string;
  slug: string;
  displayName: string;
  type: string;
  isRequired: boolean;
  isEditable: boolean;
}

export interface WebflowCollection {
  id: string;
  displayName: string;
  singularName: string;
  slug: string;
  fields: WebflowField[];
  lastUpdated?: string;
}

export interface WebflowCollectionSummary {
  id: string;
  displayName: string;
  singularName: string;
  slug: string;
}

export interface WebflowItem {
  id: string;
  cmsLocaleId?: string;
  lastPublished?: string | null;
  lastUpdated?: string;
  createdOn?: string;
  isArchived: boolean;
  isDraft: boolean;
  fieldData: Record<string, unknown>;
}

export class WebflowClient {
  constructor(private readonly apiToken: string) {
    if (!apiToken) {
      throw new Error(
        "Missing Webflow API token. Set WEBFLOW_API_TOKEN in the environment."
      );
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(`${WEBFLOW_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        "accept-version": "2.0.0",
        ...init.headers,
      },
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      throw new WebflowApiError(res.status, res.statusText, body);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async listCollections(siteId: string): Promise<WebflowCollectionSummary[]> {
    const data = await this.request<{ collections: WebflowCollectionSummary[] }>(
      `/sites/${siteId}/collections`
    );
    return data.collections;
  }

  async getCollectionSchema(collectionId: string): Promise<WebflowCollection> {
    return this.request<WebflowCollection>(`/collections/${collectionId}`);
  }

  async listItems(
    collectionId: string,
    options: { limit?: number; offset?: number; slug?: string } = {}
  ): Promise<{ items: WebflowItem[]; pagination: { limit: number; offset: number; total: number } }> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    const query = params.toString();
    const data = await this.request<{
      items: WebflowItem[];
      pagination: { limit: number; offset: number; total: number };
    }>(`/collections/${collectionId}/items${query ? `?${query}` : ""}`);

    if (options.slug) {
      return {
        ...data,
        items: data.items.filter((item) => item.fieldData.slug === options.slug),
      };
    }
    return data;
  }

  async getItem(collectionId: string, itemId: string): Promise<WebflowItem> {
    return this.request<WebflowItem>(
      `/collections/${collectionId}/items/${itemId}`
    );
  }

  async createItem(
    collectionId: string,
    fieldData: Record<string, unknown>,
    options: { isDraft?: boolean } = {}
  ): Promise<WebflowItem> {
    return this.request<WebflowItem>(`/collections/${collectionId}/items`, {
      method: "POST",
      body: JSON.stringify({
        isArchived: false,
        isDraft: options.isDraft ?? true,
        fieldData,
      }),
    });
  }

  async updateItem(
    collectionId: string,
    itemId: string,
    fieldData: Record<string, unknown>
  ): Promise<WebflowItem> {
    return this.request<WebflowItem>(
      `/collections/${collectionId}/items/${itemId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ fieldData }),
      }
    );
  }

  async publishSite(siteId: string, customDomains: string[] = []): Promise<unknown> {
    return this.request(`/sites/${siteId}/publish`, {
      method: "POST",
      body: JSON.stringify({
        publishToWebflowSubdomain: true,
        ...(customDomains.length ? { customDomains } : {}),
      }),
    });
  }
}
