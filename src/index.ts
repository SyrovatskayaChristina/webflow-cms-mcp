#!/usr/bin/env node
/**
 * webflow-cms-mcp
 *
 * An MCP server that exposes a Webflow CMS site as a set of structured
 * tools an AI agent can call: list collections, inspect a collection's
 * live schema, read items, create/update items with schema validation,
 * and publish the site.
 *
 * Why this exists: in a production content pipeline (n8n + an LLM +
 * Webflow CMS), the riskiest step is the hand-off between "the model
 * decided what to write" and "the CMS record changed." This server
 * narrows that hand-off to typed, schema-checked tool calls instead of
 * a free-text HTTP call the model has to get exactly right on its own.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WebflowApiError, WebflowClient } from "./webflowClient.js";
import { validateFieldData } from "./validation.js";

const API_TOKEN = process.env.WEBFLOW_API_TOKEN ?? "";
const DEFAULT_SITE_ID = process.env.WEBFLOW_SITE_ID; // optional convenience default

const webflow = new WebflowClient(API_TOKEN);

function siteIdOrDefault(siteId?: string): string {
  const id = siteId ?? DEFAULT_SITE_ID;
  if (!id) {
    throw new Error(
      "No site ID given and WEBFLOW_SITE_ID is not set in the environment."
    );
  }
  return id;
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function handleWebflowCall<T>(fn: () => Promise<T>) {
  try {
    const result = await fn();
    return textResult(result);
  } catch (err) {
    if (err instanceof WebflowApiError) {
      return errorResult(
        `Webflow API error (${err.status} ${err.statusText}): ${JSON.stringify(
          err.body
        )}`
      );
    }
    return errorResult(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

const server = new McpServer({
  name: "webflow-cms-mcp",
  version: "1.0.0",
});

server.tool(
  "list_collections",
  "List all CMS collections on a Webflow site, with their IDs, names, and slugs.",
  {
    siteId: z
      .string()
      .optional()
      .describe("Webflow site ID. Falls back to WEBFLOW_SITE_ID if omitted."),
  },
  async ({ siteId }) =>
    handleWebflowCall(() => webflow.listCollections(siteIdOrDefault(siteId)))
);

server.tool(
  "get_collection_schema",
  "Get the live field schema for a CMS collection — field slugs, display names, types, and which fields are required/editable. Call this before creating or updating items so field names match exactly.",
  {
    collectionId: z.string().describe("Webflow collection ID."),
  },
  async ({ collectionId }) =>
    handleWebflowCall(() => webflow.getCollectionSchema(collectionId))
);

server.tool(
  "list_items",
  "List items in a CMS collection, with pagination. Optionally filter to a single item by its slug.",
  {
    collectionId: z.string().describe("Webflow collection ID."),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
    slug: z
      .string()
      .optional()
      .describe("If set, return only the item whose slug matches exactly."),
  },
  async ({ collectionId, limit, offset, slug }) =>
    handleWebflowCall(() =>
      webflow.listItems(collectionId, { limit, offset, slug })
    )
);

server.tool(
  "get_item",
  "Get a single CMS item by its item ID.",
  {
    collectionId: z.string().describe("Webflow collection ID."),
    itemId: z.string().describe("Webflow item ID."),
  },
  async ({ collectionId, itemId }) =>
    handleWebflowCall(() => webflow.getItem(collectionId, itemId))
);

server.tool(
  "create_item",
  "Create a new CMS item. The fieldData is validated against the collection's live schema first (unknown field names or missing required fields are rejected with a clear error instead of silently failing at the API).",
  {
    collectionId: z.string().describe("Webflow collection ID."),
    fieldData: z
      .record(z.unknown())
      .describe(
        "Field values keyed by field slug, e.g. { \"name\": \"...\", \"slug\": \"...\", \"performance-header\": \"...\" }"
      ),
    isDraft: z
      .boolean()
      .optional()
      .describe("Create as a draft (default true) rather than publish-ready."),
  },
  async ({ collectionId, fieldData, isDraft }) => {
    try {
      const schema = await webflow.getCollectionSchema(collectionId);
      const validation = validateFieldData(schema, fieldData);
      if (!validation.valid) {
        return errorResult(
          `Validation failed, item not created:\n${validation.errors.join("\n")}`
        );
      }
      const item = await webflow.createItem(collectionId, fieldData, {
        isDraft,
      });
      const note = validation.warnings.length
        ? `\n\nWarnings: ${validation.warnings.join("; ")}`
        : "";
      return textResult(`${JSON.stringify(item, null, 2)}${note}`);
    } catch (err) {
      if (err instanceof WebflowApiError) {
        return errorResult(
          `Webflow API error (${err.status} ${err.statusText}): ${JSON.stringify(
            err.body
          )}`
        );
      }
      return errorResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
);

server.tool(
  "update_item",
  "Update an existing CMS item. The fieldData is validated against the collection's live schema first — unknown field slugs are rejected rather than sent to the API, which is what usually happens when a schema has drifted since the integration was written.",
  {
    collectionId: z.string().describe("Webflow collection ID."),
    itemId: z.string().describe("Webflow item ID."),
    fieldData: z
      .record(z.unknown())
      .describe("Field values to update, keyed by field slug."),
  },
  async ({ collectionId, itemId, fieldData }) => {
    try {
      const schema = await webflow.getCollectionSchema(collectionId);
      const validation = validateFieldData(schema, fieldData, {
        isUpdate: true,
      });
      if (!validation.valid) {
        return errorResult(
          `Validation failed, item not updated:\n${validation.errors.join("\n")}`
        );
      }
      const item = await webflow.updateItem(collectionId, itemId, fieldData);
      const note = validation.warnings.length
        ? `\n\nWarnings: ${validation.warnings.join("; ")}`
        : "";
      return textResult(`${JSON.stringify(item, null, 2)}${note}`);
    } catch (err) {
      if (err instanceof WebflowApiError) {
        return errorResult(
          `Webflow API error (${err.status} ${err.statusText}): ${JSON.stringify(
            err.body
          )}`
        );
      }
      return errorResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
);

server.tool(
  "publish_site",
  "Publish the live Webflow site so CMS changes go live. Use after creating/updating items that should be visible to visitors.",
  {
    siteId: z
      .string()
      .optional()
      .describe("Webflow site ID. Falls back to WEBFLOW_SITE_ID if omitted."),
    customDomains: z
      .array(z.string())
      .optional()
      .describe("Custom domains to publish to, in addition to the Webflow subdomain."),
  },
  async ({ siteId, customDomains }) =>
    handleWebflowCall(() =>
      webflow.publishSite(siteIdOrDefault(siteId), customDomains)
    )
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("webflow-cms-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting webflow-cms-mcp:", err);
  process.exit(1);
});
