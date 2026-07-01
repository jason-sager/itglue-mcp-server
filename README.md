# itglue-mcp-server

An unofficial [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the [ITGlue](https://www.itglue.com/) API. Enables AI assistants to manage ITGlue documents, document sections, and organizations.

> **Note**: This is an unofficial, community-maintained project and is not affiliated with or endorsed by Kaseya/ITGlue.
>
> This package (`@jasonsager/itglue-mcp-server`) is a fork of [Junto-Platforms/itglue-mcp-server](https://github.com/Junto-Platforms/itglue-mcp-server) that adds working client-side name search and a local content-search index. See [Local Search Index](#local-search-index).

## Features

- **16 tools** covering documents, document sections, organizations, and a local search index
- Full CRUD support for documents and document sections
- Publish documents directly from your AI assistant
- Organization lookup for finding org IDs
- Pagination, filtering, and sorting support
- **Local search index** for fast keyword search across all document titles and, per-organization, body content — stored compressed on disk
- Markdown and JSON response formats
- Regional API support (US, EU, Australia)
- Stdio and streaming HTTP transports
- Docker support for containerized deployment

## Quick Start

### Claude Desktop

1. Open Claude Desktop and go to **Settings > Developer > Edit Config**
2. Add the following to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "itglue": {
      "command": "npx",
      "args": ["-y", "@jasonsager/itglue-mcp-server"],
      "env": {
        "ITGLUE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

3. Save the file and **restart Claude Desktop**

Config file locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Streaming HTTP

Start the server in HTTP mode:

```bash
ITGLUE_API_KEY=your-key npx @jasonsager/itglue-mcp-server --transport http --port 3000
```

Then configure your MCP client:

```json
{
  "mcpServers": {
    "itglue": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Other MCP Clients (Cursor, Windsurf, Claude Code, etc.)

Most MCP clients use the same stdio configuration format shown above.

### EU or Australia Regions

Add `--region eu` or `--region au` to the args:

```json
{
  "mcpServers": {
    "itglue": {
      "command": "npx",
      "args": ["-y", "@jasonsager/itglue-mcp-server", "--region", "eu"],
      "env": {
        "ITGLUE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `ITGLUE_API_KEY` | ITGlue API key | Yes | |
| `ITGLUE_BASE_URL` | Custom API base URL | No | `https://api.itglue.com` |
| `TRANSPORT` | Transport mode: `stdio` or `http` | No | `stdio` |
| `PORT` | HTTP server port | No | `3000` |

### CLI Options

```
--api-key <key>         ITGlue API key (overrides env var)
--base-url <url>        Custom API base URL (overrides env var)
--region <region>       API region: us, eu, or au (default: us)
--transport <mode>      Transport mode: stdio or http (default: stdio)
--port <port>           HTTP server port (default: 3000)
--help                  Show help
--version               Show version
```

## Tools

### Organizations

| Tool | Description |
|------|-------------|
| `itglue_list_organizations` | Search and list organizations with filtering and pagination |
| `itglue_get_organization` | Get detailed information about a specific organization |

### Documents

| Tool | Description |
|------|-------------|
| `itglue_list_documents` | List documents globally or within an organization |
| `itglue_get_document` | Get a document with all embedded sections |
| `itglue_create_document` | Create a new draft document |
| `itglue_update_document` | Update document metadata (name) |
| `itglue_publish_document` | Publish a draft document |
| `itglue_delete_documents` | Permanently delete one or more documents |

### Document Sections

| Tool | Description |
|------|-------------|
| `itglue_list_document_sections` | List all sections in a document |
| `itglue_get_document_section` | Get a specific section with full content |
| `itglue_create_document_section` | Add a section (Text, Heading, Gallery, Step) |
| `itglue_update_document_section` | Update section content, type, or position |
| `itglue_delete_document_section` | Permanently delete a section |

### Search Index

| Tool | Description |
|------|-------------|
| `itglue_index_documents` | Build/update the local search index (titles for all orgs; content per org) |
| `itglue_search_documents` | Fast keyword search over the index (no live API calls) |
| `itglue_index_status` | Report what is cached, sizes, and staleness |

## Search & Filtering

`filter_name` on `itglue_list_documents` and `itglue_list_organizations` performs a **case-insensitive substring match**. The ITGlue API cannot filter documents by name (and its organization name filter is exact-match only), so name filtering is applied **client-side**: the tool retrieves the full list for the scope and matches locally, then paginates. ID, type, and status filters are exact and applied server-side. When you already know the exact ID, prefer `filter_id` to avoid fetching the whole list.

## Local Search Index

The ITGlue API has **no full-text search** and cannot filter documents by name, which makes "find the document about X" hard across a large instance. This server adds a local, on-disk index you build explicitly and then search instantly (search never calls the API).

**Two tiers:**

- **Titles** — cheap, covers **all** organizations. Build with `itglue_index_documents` (no `organization_id`).
- **Content** — opt-in and **per organization** (costs roughly one API call per document). Build with `itglue_index_documents` using `organization_id` + `include_content: true`.

**Build vs. update:**

- `mode: "full"` rebuilds the scope from scratch.
- `mode: "incremental"` (default) re-sweeps titles cheaply, then re-fetches content only for added/changed documents and drops deleted ones — so routine refreshes are fast.

**Searching:** `itglue_search_documents` ranks by keyword overlap (title matches weighted above content matches). Pass `search_content: true` to also match indexed body text. Use `itglue_index_status` to see coverage and staleness.

**Storage & privacy:** the cache is gzipped JSON. Document content is stored **only as a sorted, deduplicated set of keyword terms** — word order and repetition are discarded, so the cache is compact and the original text **cannot be reconstructed** from it. Typical footprint: a few MB for ~100k titles; roughly a few hundred KB per 1,000-document content shard.

**Cache location:** defaults to a per-OS cache directory (`%LOCALAPPDATA%\itglue-mcp-server\cache` on Windows, `~/Library/Caches/itglue-mcp-server` on macOS, `$XDG_CACHE_HOME/itglue-mcp-server` on Linux). Override with `--cache-dir <path>` or the `ITGLUE_CACHE_DIR` environment variable. The cache is namespaced by API host, so US/EU/AU instances don't collide.

> This search-index feature is a fork addition and is not part of the upstream project.

## API Key Setup

1. Log in to ITGlue as an Administrator
2. Go to **Account > Settings > API Keys**
3. Generate a new Custom API Key
4. Copy the key and set it as `ITGLUE_API_KEY`

> ITGlue automatically revokes API keys unused for 90+ days.

## Regions

| Region | Base URL |
|--------|----------|
| US (default) | `https://api.itglue.com` |
| EU | `https://api.eu.itglue.com` |
| Australia | `https://api.au.itglue.com` |

## Rate Limiting

The ITGlue API allows a maximum of 3,000 requests per 5-minute window. The server will return clear error messages if the rate limit is exceeded.

## Docker

### Build and run locally

```bash
docker build -t itglue-mcp-server .
docker run --rm -p 3000:3000 -e ITGLUE_API_KEY=your-key itglue-mcp-server
```

The Docker image runs in HTTP transport mode by default on port 3000.

### Pre-built image

```bash
docker pull ghcr.io/junto-platforms/itglue-mcp-server:latest
docker run --rm -p 3000:3000 -e ITGLUE_API_KEY=your-key ghcr.io/junto-platforms/itglue-mcp-server:latest
```

### Health check

```bash
curl http://localhost:3000/health
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally (stdio)
ITGLUE_API_KEY=your-key node dist/index.js

# Run locally (HTTP)
ITGLUE_API_KEY=your-key node dist/index.js --transport http

# Development with auto-reload
ITGLUE_API_KEY=your-key npm run dev

# Development with HTTP transport
ITGLUE_API_KEY=your-key npm run dev:http

# Run tests
npm test
```

## Sponsored by Junto

Secure client access, automated ticket resolution, and intelligent IT operations. Discover how Junto is transforming MSP service delivery at [juntoai.com](https://juntoai.com).

## License

MIT
