// Golden snapshots for the document-index tool group (Phase 0 refactor safety net).
//
// These lock the CURRENT verbatim output of every tool: itglue_index_documents,
// itglue_search_documents, itglue_index_status — across markdown, json, and
// isError paths. A later factory refactor MUST keep these byte-identical.
//
// registerIndexTools has a non-standard signature: (server, indexer, searcher,
// store). It does NOT use the http client. Every variable field (durations,
// byte sizes, timestamps, counts) is pinned to a fixed literal in the mocks so
// the formatted output is fully deterministic.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerIndexTools } from "./document-index.js";
import { makeMockServer } from "../test-helpers.js";
import type {
  BuildReport,
  SearchResponse,
  IndexManifest,
} from "../services/index/types.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("document-index tool snapshots", () => {
  let mockServer: ReturnType<typeof makeMockServer>;
  let indexer: { build: ReturnType<typeof vi.fn> };
  let searcher: { search: ReturnType<typeof vi.fn> };
  let store: { readManifest: ReturnType<typeof vi.fn> };
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockServer = makeMockServer();
    indexer = { build: vi.fn() };
    searcher = { search: vi.fn() };
    store = { readManifest: vi.fn() };
    registerIndexTools(
      mockServer as never,
      indexer as never,
      searcher as never,
      store as never
    );
    handlers = {};
    for (const call of mockServer.registerTool.mock.calls) {
      handlers[call[0] as string] = call[2] as ToolHandler;
    }
  });

  // ── Fixed fixtures ────────────────────────────────────────────────
  const fullReport: BuildReport = {
    mode: "full",
    organizationId: "123",
    includeContent: true,
    orgsProcessed: 1,
    titlesIndexed: 42,
    titlesAdded: 0,
    titlesChanged: 0,
    titlesDeleted: 0,
    contentDocsIndexed: 42,
    contentPath: "per-doc",
    apiCalls: 45,
    durationMs: 12345,
    cacheBytes: 2_500_000,
    cachePath: "/home/user/.cache/itglue/api.itglue.com",
    capabilities: {
      sideloadSections: true,
      globalDocumentsSweep: false,
      sparseFieldsets: true,
      probedAt: "2026-06-01T00:00:00.000Z",
    },
  };

  const searchResponse: SearchResponse = {
    query: "vpn firewall",
    results: [
      {
        id: "1001",
        name: "VPN Runbook",
        org_id: "123",
        org_name: "Acme Corp",
        updated_at: "2026-05-01T12:00:00.000Z",
        published: true,
        score: 7,
        title_matches: ["vpn"],
        content_matches: ["firewall", "tunnel"],
        content_indexed: true,
      },
      {
        id: "1002",
        name: "Firewall Policy",
        org_id: "456",
        org_name: "Globex",
        updated_at: "2026-04-15T08:30:00.000Z",
        published: false,
        score: 3,
        title_matches: ["firewall"],
        content_matches: [],
        content_indexed: false,
      },
    ],
    total_count: 5,
    page_number: 1,
    page_size: 2,
    has_more: true,
    titles_built_at: "2026-06-01T00:00:00.000Z",
    searched_content: true,
    content_orgs_missing: ["456"],
  };

  const manifest: IndexManifest = {
    schemaVersion: 1,
    host: "/home/user/.cache/itglue/api.itglue.com",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    capabilities: {
      sideloadSections: true,
      globalDocumentsSweep: false,
      sparseFieldsets: true,
      probedAt: "2026-06-01T00:00:00.000Z",
    },
    titles: {
      count: 42,
      builtAt: "2026-06-01T00:00:00.000Z",
      bytesOnDisk: 100_000,
    },
    orgs: {
      "123": {
        org_id: "123",
        org_name: "Acme Corp",
        titlesCount: 30,
        contentIndexed: true,
        contentDocCount: 30,
        contentBytesOnDisk: 2_400_000,
        lastTitlesAt: "2026-06-01T00:00:00.000Z",
        lastContentAt: "2026-06-01T00:00:00.000Z",
        lastPathUsed: "per-doc",
      },
      "456": {
        org_id: "456",
        org_name: "Globex",
        titlesCount: 12,
        contentIndexed: false,
        contentDocCount: 0,
        contentBytesOnDisk: 0,
        lastTitlesAt: "2026-06-01T00:00:00.000Z",
        lastContentAt: null,
        lastPathUsed: null,
      },
    },
    totals: {
      orgCount: 2,
      titleCount: 42,
      contentOrgCount: 1,
      contentDocCount: 30,
      bytesOnDisk: 2_500_000,
    },
  };

  // ── itglue_index_documents ────────────────────────────────────────
  describe("itglue_index_documents", () => {
    it("markdown: full build with content + capabilities", async () => {
      indexer.build.mockResolvedValue(fullReport);
      const res = await handlers["itglue_index_documents"]({
        mode: "full",
        organization_id: 123,
        include_content: true,
        response_format: "markdown",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "# Index Build Complete

        - **Mode**: full
        - **Scope**: organization 123
        - **Organizations processed**: 1
        - **Titles indexed**: 42
        - **Content documents indexed**: 42 (path: per-doc)
        - **API calls**: 45
        - **Duration**: 12.3s
        - **Cache size**: 2.4 MB
        - **Cache path**: /home/user/.cache/itglue/api.itglue.com
        - **API capabilities**: sideload=true, sparse=true, global-sweep=false"
      `);
    });

    it("json: full build report serialized verbatim", async () => {
      indexer.build.mockResolvedValue(fullReport);
      const res = await handlers["itglue_index_documents"]({
        mode: "full",
        organization_id: 123,
        include_content: true,
        response_format: "json",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "{
          "mode": "full",
          "organizationId": "123",
          "includeContent": true,
          "orgsProcessed": 1,
          "titlesIndexed": 42,
          "titlesAdded": 0,
          "titlesChanged": 0,
          "titlesDeleted": 0,
          "contentDocsIndexed": 42,
          "contentPath": "per-doc",
          "apiCalls": 45,
          "durationMs": 12345,
          "cacheBytes": 2500000,
          "cachePath": "/home/user/.cache/itglue/api.itglue.com",
          "capabilities": {
            "sideloadSections": true,
            "globalDocumentsSweep": false,
            "sparseFieldsets": true,
            "probedAt": "2026-06-01T00:00:00.000Z"
          }
        }"
      `);
    });

    it("markdown: incremental titles-only build (no content, no capabilities)", async () => {
      const incremental: BuildReport = {
        mode: "incremental",
        organizationId: null,
        includeContent: false,
        orgsProcessed: 8,
        titlesIndexed: 120,
        titlesAdded: 5,
        titlesChanged: 3,
        titlesDeleted: 2,
        contentDocsIndexed: 0,
        contentPath: null,
        apiCalls: 9,
        durationMs: 3400,
        cacheBytes: 512,
        cachePath: "/home/user/.cache/itglue/api.itglue.com",
        capabilities: null,
      };
      indexer.build.mockResolvedValue(incremental);
      const res = await handlers["itglue_index_documents"]({
        mode: "incremental",
        include_content: false,
        response_format: "markdown",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "# Index Update Complete

        - **Mode**: incremental
        - **Scope**: all organizations (titles)
        - **Organizations processed**: 8
        - **Titles indexed**: 120
        - **Added / Changed / Deleted**: 5 / 3 / 2
        - **API calls**: 9
        - **Duration**: 3.4s
        - **Cache size**: 512 B
        - **Cache path**: /home/user/.cache/itglue/api.itglue.com"
      `);
    });

    it("isError: build throws", async () => {
      indexer.build.mockRejectedValue(new Error("boom"));
      const res = await handlers["itglue_index_documents"]({
        mode: "full",
        include_content: false,
        response_format: "markdown",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: boom"`);
    });
  });

  // ── itglue_search_documents ───────────────────────────────────────
  describe("itglue_search_documents", () => {
    it("markdown: ranked results with content matches + pagination + missing-content note", async () => {
      searcher.search.mockResolvedValue({
        status: "ok",
        response: searchResponse,
      });
      const res = await handlers["itglue_search_documents"]({
        query: "vpn firewall",
        search_content: true,
        page_number: 1,
        page_size: 2,
        response_format: "markdown",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "# Search Results for "vpn firewall" (5 total)

        ## VPN Runbook (ID: 1001)
        - **Organization**: Acme Corp (ID: 123)
        - **Score**: 7
        - **Title matches**: vpn
        - **Content matches**: firewall, tunnel
        - **Updated**: 2026-05-01T12:00:00.000Z

        ## Firewall Policy (ID: 1002)
        - **Organization**: Globex (ID: 456)
        - **Score**: 3
        - **Title matches**: firewall
        - **Content matches**: content not indexed
        - **Updated**: 2026-04-15T08:30:00.000Z

        ---
        Page 1 | 5 total results
        More results available — use page_number: 2 to see next page
        Index built: 2026-06-01T00:00:00.000Z
        Note: 1 organization(s) in scope have no content index — run itglue_index_documents with include_content for them."
      `);
    });

    it("json: search response serialized verbatim", async () => {
      searcher.search.mockResolvedValue({
        status: "ok",
        response: searchResponse,
      });
      const res = await handlers["itglue_search_documents"]({
        query: "vpn firewall",
        search_content: true,
        page_number: 1,
        page_size: 2,
        response_format: "json",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "{
          "query": "vpn firewall",
          "results": [
            {
              "id": "1001",
              "name": "VPN Runbook",
              "org_id": "123",
              "org_name": "Acme Corp",
              "updated_at": "2026-05-01T12:00:00.000Z",
              "published": true,
              "score": 7,
              "title_matches": [
                "vpn"
              ],
              "content_matches": [
                "firewall",
                "tunnel"
              ],
              "content_indexed": true
            },
            {
              "id": "1002",
              "name": "Firewall Policy",
              "org_id": "456",
              "org_name": "Globex",
              "updated_at": "2026-04-15T08:30:00.000Z",
              "published": false,
              "score": 3,
              "title_matches": [
                "firewall"
              ],
              "content_matches": [],
              "content_indexed": false
            }
          ],
          "total_count": 5,
          "page_number": 1,
          "page_size": 2,
          "has_more": true,
          "titles_built_at": "2026-06-01T00:00:00.000Z",
          "searched_content": true,
          "content_orgs_missing": [
            "456"
          ]
        }"
      `);
    });

    it("markdown: no results matched", async () => {
      searcher.search.mockResolvedValue({
        status: "ok",
        response: {
          query: "nonexistent",
          results: [],
          total_count: 0,
          page_number: 1,
          page_size: 50,
          has_more: false,
          titles_built_at: "2026-06-01T00:00:00.000Z",
          searched_content: false,
          content_orgs_missing: [],
        } satisfies SearchResponse,
      });
      const res = await handlers["itglue_search_documents"]({
        query: "nonexistent",
        search_content: false,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`"No documents matched "nonexistent"."`);
    });

    it("guidance: no index built yet (non-ok status)", async () => {
      searcher.search.mockResolvedValue({
        status: "no-index",
        message: "No search index found. Run itglue_index_documents.",
      });
      const res = await handlers["itglue_search_documents"]({
        query: "vpn",
        search_content: false,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });
      expect(res.isError).toBeUndefined();
      expect(res.content[0].text).toMatchInlineSnapshot(`"No search index found. Run itglue_index_documents."`);
    });

    it("isError: search throws", async () => {
      searcher.search.mockRejectedValue(new Error("index corrupt"));
      const res = await handlers["itglue_search_documents"]({
        query: "vpn",
        search_content: false,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: index corrupt"`);
    });
  });

  // ── itglue_index_status ───────────────────────────────────────────
  describe("itglue_index_status", () => {
    it("markdown: full manifest with capabilities + multiple orgs", async () => {
      store.readManifest.mockResolvedValue(manifest);
      const res = await handlers["itglue_index_status"]({
        response_format: "markdown",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "# ITGlue Search Index Status

        - **Cache path**: /home/user/.cache/itglue/api.itglue.com
        - **Titles**: 42 documents across 2 organizations (built 2026-06-01T00:00:00.000Z)
        - **Content-indexed organizations**: 1 (30 documents)
        - **Total cache size**: 2.4 MB
        - **API capabilities**: sideload=true, sparse=true, global-sweep=false

        ## Organizations

        - **Acme Corp** (ID: 123) — 30 titles; content: 30 docs, 2.3 MB (per-doc)
        - **Globex** (ID: 456) — 12 titles; content: not indexed"
      `);
    });

    it("json: manifest serialized verbatim", async () => {
      store.readManifest.mockResolvedValue(manifest);
      const res = await handlers["itglue_index_status"]({
        response_format: "json",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "{
          "schemaVersion": 1,
          "host": "/home/user/.cache/itglue/api.itglue.com",
          "createdAt": "2026-05-01T00:00:00.000Z",
          "updatedAt": "2026-06-01T00:00:00.000Z",
          "capabilities": {
            "sideloadSections": true,
            "globalDocumentsSweep": false,
            "sparseFieldsets": true,
            "probedAt": "2026-06-01T00:00:00.000Z"
          },
          "titles": {
            "count": 42,
            "builtAt": "2026-06-01T00:00:00.000Z",
            "bytesOnDisk": 100000
          },
          "orgs": {
            "123": {
              "org_id": "123",
              "org_name": "Acme Corp",
              "titlesCount": 30,
              "contentIndexed": true,
              "contentDocCount": 30,
              "contentBytesOnDisk": 2400000,
              "lastTitlesAt": "2026-06-01T00:00:00.000Z",
              "lastContentAt": "2026-06-01T00:00:00.000Z",
              "lastPathUsed": "per-doc"
            },
            "456": {
              "org_id": "456",
              "org_name": "Globex",
              "titlesCount": 12,
              "contentIndexed": false,
              "contentDocCount": 0,
              "contentBytesOnDisk": 0,
              "lastTitlesAt": "2026-06-01T00:00:00.000Z",
              "lastContentAt": null,
              "lastPathUsed": null
            }
          },
          "totals": {
            "orgCount": 2,
            "titleCount": 42,
            "contentOrgCount": 1,
            "contentDocCount": 30,
            "bytesOnDisk": 2500000
          }
        }"
      `);
    });

    it("markdown: filtered to a single organization", async () => {
      store.readManifest.mockResolvedValue(manifest);
      const res = await handlers["itglue_index_status"]({
        organization_id: 123,
        response_format: "markdown",
      });
      expect(res.content[0].text).toMatchInlineSnapshot(`
        "# ITGlue Search Index Status

        - **Cache path**: /home/user/.cache/itglue/api.itglue.com
        - **Titles**: 42 documents across 2 organizations (built 2026-06-01T00:00:00.000Z)
        - **Content-indexed organizations**: 1 (30 documents)
        - **Total cache size**: 2.4 MB
        - **API capabilities**: sideload=true, sparse=true, global-sweep=false

        ## Organizations

        - **Acme Corp** (ID: 123) — 30 titles; content: 30 docs, 2.3 MB (per-doc)"
      `);
    });

    it("guidance: no manifest exists yet", async () => {
      store.readManifest.mockResolvedValue(null);
      const res = await handlers["itglue_index_status"]({
        response_format: "markdown",
      });
      expect(res.isError).toBeUndefined();
      expect(res.content[0].text).toMatchInlineSnapshot(`"No search index has been built yet. Run itglue_index_documents to create one."`);
    });

    it("isError: readManifest throws", async () => {
      store.readManifest.mockRejectedValue(new Error("disk failure"));
      const res = await handlers["itglue_index_status"]({
        response_format: "markdown",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: disk failure"`);
    });
  });
});
