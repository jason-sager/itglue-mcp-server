import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerIndexTools } from "./document-index.js";
import { makeMockServer } from "../test-helpers.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("registerIndexTools", () => {
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

  it("registers exactly 3 tools", () => {
    expect(mockServer.registerTool).toHaveBeenCalledTimes(3);
    expect(handlers).toHaveProperty("itglue_index_documents");
    expect(handlers).toHaveProperty("itglue_search_documents");
    expect(handlers).toHaveProperty("itglue_index_status");
  });

  describe("itglue_index_documents", () => {
    const report = {
      mode: "full",
      organizationId: "1",
      includeContent: true,
      orgsProcessed: 1,
      titlesIndexed: 2,
      titlesAdded: 0,
      titlesChanged: 0,
      titlesDeleted: 0,
      contentDocsIndexed: 2,
      contentPath: "per-doc",
      apiCalls: 5,
      durationMs: 1000,
      cacheBytes: 2048,
      cachePath: "/cache",
      capabilities: null,
    };

    it("maps params to the indexer and formats the report", async () => {
      indexer.build.mockResolvedValue(report);
      const res = await handlers["itglue_index_documents"]({
        mode: "full",
        organization_id: 1,
        include_content: true,
        response_format: "markdown",
      });
      expect(indexer.build).toHaveBeenCalledWith({
        mode: "full",
        organizationId: "1",
        includeContent: true,
      });
      expect(res.content[0].text).toContain("Titles indexed");
      expect(res.content[0].text).toContain("per-doc");
    });

    it("returns JSON when requested", async () => {
      indexer.build.mockResolvedValue(report);
      const res = await handlers["itglue_index_documents"]({
        mode: "full",
        organization_id: 1,
        include_content: true,
        response_format: "json",
      });
      expect(JSON.parse(res.content[0].text).titlesIndexed).toBe(2);
    });

    it("returns isError when the build throws", async () => {
      indexer.build.mockRejectedValue(new Error("boom"));
      const res = await handlers["itglue_index_documents"]({
        mode: "full",
        include_content: false,
        response_format: "markdown",
      });
      expect(res.isError).toBe(true);
    });
  });

  describe("itglue_search_documents", () => {
    it("formats ranked results", async () => {
      searcher.search.mockResolvedValue({
        status: "ok",
        response: {
          query: "vpn",
          results: [
            {
              id: "1",
              name: "VPN Runbook",
              org_id: "1",
              org_name: "Acme",
              updated_at: "2024-01-01",
              published: true,
              score: 3,
              title_matches: ["vpn"],
              content_matches: [],
              content_indexed: false,
            },
          ],
          total_count: 1,
          page_number: 1,
          page_size: 50,
          has_more: false,
          titles_built_at: "2026-01-01",
          searched_content: false,
          content_orgs_missing: [],
        },
      });
      const res = await handlers["itglue_search_documents"]({
        query: "vpn",
        search_content: false,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });
      expect(res.content[0].text).toContain("Search Results");
      expect(res.content[0].text).toContain("VPN Runbook");
    });

    it("returns guidance (not an error) when no index exists", async () => {
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
      expect(res.content[0].text).toContain("No search index");
      expect(res.isError).toBeUndefined();
    });
  });

  describe("itglue_index_status", () => {
    it("reports when nothing is indexed", async () => {
      store.readManifest.mockResolvedValue(null);
      const res = await handlers["itglue_index_status"]({
        response_format: "markdown",
      });
      expect(res.content[0].text).toContain("No search index");
    });

    it("formats the manifest", async () => {
      store.readManifest.mockResolvedValue({
        schemaVersion: 1,
        host: "api.itglue.com",
        createdAt: "t",
        updatedAt: "t",
        capabilities: null,
        titles: { count: 2, builtAt: "t", bytesOnDisk: 100 },
        orgs: {
          "1": {
            org_id: "1",
            org_name: "Acme",
            titlesCount: 2,
            contentIndexed: true,
            contentDocCount: 2,
            contentBytesOnDisk: 50,
            lastTitlesAt: "t",
            lastContentAt: "t",
            lastPathUsed: "per-doc",
          },
        },
        totals: {
          orgCount: 1,
          titleCount: 2,
          contentOrgCount: 1,
          contentDocCount: 2,
          bytesOnDisk: 150,
        },
      });
      const res = await handlers["itglue_index_status"]({
        response_format: "markdown",
      });
      expect(res.content[0].text).toContain("Index Status");
      expect(res.content[0].text).toContain("Acme");
    });
  });
});
