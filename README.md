# webflow-cms-mcp

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that exposes a Webflow CMS site as a set of typed, schema-validated tools an AI agent can call — instead of a free-text HTTP integration the model has to get right on its own.

Built as a standalone portfolio project to demonstrate connecting an LLM agent to a real corporate system (a content CMS) via MCP: structured tool definitions, input validation, and a schema-drift guardrail, rather than a toy "hello world" server.

## Why this shape

In a production content pipeline — an LLM generating structured content and writing it into a CMS — the riskiest step is the hand-off between "the model decided what to write" and "the CMS record actually changed." Three things go wrong in practice:

1. **The model invents a field name** that doesn't exist, or that existed under an older version of the schema.
2. **A required field gets silently skipped**, and the CMS either rejects the write or creates a broken record.
3. **The CMS schema changes** (a field gets renamed or split) and nothing catches the mismatch until content stops updating.

This server addresses all three the same way: `create_item` and `update_item` fetch the collection's **live** schema from Webflow on every call and validate the proposed `fieldData` against it *before* writing — unknown field slugs and missing required fields are rejected with a clear message, instead of failing silently or being sent to the API as-is.

## Tools

| Tool | What it does |
|---|---|
| `list_collections` | List all CMS collections on a site, with IDs, names, and slugs |
| `get_collection_schema` | Get a collection's live field schema — slugs, types, required/editable flags |
| `list_items` | List items in a collection, with pagination and optional slug filter |
| `get_item` | Get a single item by ID |
| `create_item` | Create an item — validated against the live schema first |
| `update_item` | Update an item — validated against the live schema first |
| `publish_site` | Publish the live site so CMS changes go live |

## Architecture

```
┌─────────────┐     stdio (JSON-RPC / MCP)     ┌──────────────────┐     HTTPS      ┌─────────────┐
│  MCP client │ ──────────────────────────────▶│  webflow-cms-mcp │ ──────────────▶│ Webflow API  │
│ (Claude, an │◀────────────────────────────── │                  │◀────────────── │     (v2)     │
│  agent, …)  │        tool calls / results     │  • schema fetch  │   JSON over     │              │
└─────────────┘                                 │  • validation    │   HTTPS         └─────────────┘
                                                 │  • typed tools   │
                                                 └──────────────────┘
```

The server speaks MCP over stdio to whatever client launches it (Claude Desktop, Claude Code, or any other MCP-compatible agent host) and talks to Webflow's REST API over HTTPS using a bearer token.

## Setup

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` and fill in a Webflow API token (Site settings → Apps & integrations → API access) and, optionally, a default site ID:

```bash
cp .env.example .env
```

### Run it directly

```bash
WEBFLOW_API_TOKEN=xxx WEBFLOW_SITE_ID=xxx node build/index.js
```

### Use it from Claude Desktop / Claude Code

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "webflow-cms": {
      "command": "node",
      "args": ["/absolute/path/to/webflow-cms-mcp/build/index.js"],
      "env": {
        "WEBFLOW_API_TOKEN": "xxx",
        "WEBFLOW_SITE_ID": "xxx"
      }
    }
  }
}
```

### Inspect it interactively

```bash
npm run inspector
```

Opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) so you can call tools and see raw request/response payloads without wiring up a full client.

## Example

Once connected, an agent can do things like:

> "List the fields on the `ai-models` collection, then create a draft item for a new model with name, slug, and a short performance summary."

The agent calls `get_collection_schema` first, gets back the real field slugs, and `create_item` rejects the call if it guesses a field name that isn't in that list — catching the mismatch before anything is written to the CMS.

## Scope and limitations

This is a focused demonstration project, not a full Webflow API wrapper:

- Covers Collections, Items, and Publish — not Assets, Forms, Ecommerce, or Site creation.
- No OAuth flow; expects a long-lived API token (standard for single-site/server-to-server use).
- Error handling surfaces the Webflow API's own error payloads rather than retry/backoff logic — a production deployment would want rate-limit handling around the Webflow API's documented limits.
- Validation is schema-shape checking (field slugs, required fields, editability), not full type-coercion (e.g. it doesn't verify a "number" field actually got a number) — a natural next step.

## Tech

TypeScript, [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), [Zod](https://zod.dev) for tool input schemas, no framework — built directly against the Webflow Data API v2.

## License

MIT
