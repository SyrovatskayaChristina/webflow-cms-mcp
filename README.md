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
| `list_sites` | List all Webflow sites this API token can access, with their site IDs |
| `list_collections` | List all CMS collections on a site, with IDs, names, and slugs |
| `get_collection_schema` | Get a collection's live field schema — slugs, types, required/editable flags |
| `get_item_template` | Get a ready-to-fill fieldData skeleton for a collection, built from its live schema |
| `list_items` | List items in a collection, with pagination and optional slug filter |
| `get_item` | Get a single item by ID |
| `create_item` | Create an item — validated against the live schema first |
| `update_item` | Update an item — validated against the live schema first |
| `publish_site` | Publish the live site so CMS changes go live |

## Architecture

```
┌─────────────┐     stdio (JSON-RPC / MCP)     ┌──────────────────┐     HTTPS      ┌─────────────┐
│  MCP client │ ──────────────────────────────▶│  webflow-cms-mcp │ ──────────────▶│ Webflow API │
│ (Claude, an │◀────────────────────────────── │                  │◀────────────── │     (v2)    │
│  agent, …)  │        tool calls / results    │  • schema fetch  │   JSON over    │             │
└─────────────┘                                │  • validation    │   HTTPS        └─────────────┘
                                               │  • typed tools   │
                                               └──────────────────┘
```

The server speaks MCP over stdio to whatever client launches it (Claude Code, Claude Desktop, or any other MCP-compatible agent host) and talks to Webflow's REST API over HTTPS using a bearer token.

## Setup

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` and fill in a Webflow API token (Site settings → Apps & integrations → API access) — scopes needed: CMS Read, CMS Write, Sites Read, and Sites Publish if you'll use `publish_site`:

```bash
cp .env.example .env
```

Then open `.env` and fill in:

```
WEBFLOW_API_TOKEN=your_token_here
WEBFLOW_SITE_ID=your_site_id_here
```

`WEBFLOW_SITE_ID` is optional — every tool that needs a site ID also accepts one as a parameter, so you can omit it here and call `list_sites` to look one up instead. `.env` is only read for local runs (`npm run inspector`, `npm start`); a client like Claude Code or Claude Desktop sets environment variables directly in its own config, so `.env` is never consulted when launched that way.

### Try it in the MCP Inspector first

```bash
npm run inspector
```

Opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) in your browser — lets you call each tool by hand and see the raw request/response JSON, without wiring up a full client. Good for a first sanity check before connecting a real agent.

A typical first pass, in order: `list_sites` (no params) → copy a site ID → `list_collections` → copy a collection ID → `get_collection_schema` to see the real field names → `get_item_template` to get a fill-in-the-blanks skeleton → `create_item` with `isDraft: true` to test a write safely.

### Use it from Claude Code

```bash
claude mcp add --transport stdio webflow-cms \
  --env WEBFLOW_API_TOKEN=your_token_here \
  --env WEBFLOW_SITE_ID=your_site_id_here \
  -- node /absolute/path/to/webflow-cms-mcp/build/index.js
```

The path to `build/index.js` must be absolute. By default this registers the server only for you, in the current project (`--scope local`). To share it with a team via a committed config, use `--scope project` instead, which writes `.mcp.json` to the project root:

```json
{
  "mcpServers": {
    "webflow-cms": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/webflow-cms-mcp/build/index.js"],
      "env": {
        "WEBFLOW_API_TOKEN": "${WEBFLOW_API_TOKEN}",
        "WEBFLOW_SITE_ID": "${WEBFLOW_SITE_ID}"
      }
    }
  }
}
```

`${VAR}` pulls from your shell environment rather than hardcoding the secret into a file you might commit. Once added, just ask Claude Code something like *"list my Webflow collections"* — it calls the tools itself.

### Use it from Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "webflow-cms": {
      "command": "node",
      "args": ["/absolute/path/to/webflow-cms-mcp/build/index.js"],
      "env": {
        "WEBFLOW_API_TOKEN": "your_token_here",
        "WEBFLOW_SITE_ID": "your_site_id_here"
      }
    }
  }
}
```

Restart Claude Desktop afterward for it to pick up the new server.

## Example

Once connected, an agent can do things like:

> "List the fields on the `ai-models` collection, then create a draft item for a new model with name, slug, and a short performance summary."

The agent calls `get_collection_schema` (or `get_item_template`) first, gets back the real field slugs, and `create_item` rejects the call if it guesses a field name that isn't in that list — catching the mismatch before anything is written to the CMS.

## Scope and limitations

This is a focused demonstration project, not a full Webflow API wrapper:

- Covers Sites, Collections, Items, and Publish — not Assets, Forms, Ecommerce, or Site creation.
- No OAuth flow; expects a long-lived API token (standard for single-site/server-to-server use).
- Error handling surfaces the Webflow API's own error payloads rather than retry/backoff logic — a production deployment would want rate-limit handling around the Webflow API's documented limits.
- Validation checks field slugs, required fields, and editability against the live schema, but doesn't type-coerce values itself — Webflow's own API still rejects a string where it expects a number, for example. `get_item_template` exists specifically to reduce that kind of mistake by showing the expected type up front.

## Tech

TypeScript, [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), [Zod](https://zod.dev) for tool input schemas, [`dotenv`](https://github.com/motdotla/dotenv) for local env loading, no framework — built directly against the Webflow Data API v2.

## License

MIT