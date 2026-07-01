import { describe, it, expect, beforeEach } from "vitest";
import { registerDocumentTools } from "./documents.js";
import { makeMockClient, makeMockServer } from "../test-helpers.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("registerDocumentTools", () => {
  let mockServer: ReturnType<typeof makeMockServer>;
  let mockClient: ReturnType<typeof makeMockClient>;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockServer = makeMockServer();
    mockClient = makeMockClient();
    registerDocumentTools(mockServer as never, mockClient as never);

    handlers = {};
    for (const call of mockServer.registerTool.mock.calls) {
      handlers[call[0] as string] = call[2] as ToolHandler;
    }
  });

  it("registers exactly 6 tools", () => {
    expect(mockServer.registerTool).toHaveBeenCalledTimes(6);
    expect(handlers).toHaveProperty("itglue_list_documents");
    expect(handlers).toHaveProperty("itglue_get_document");
    expect(handlers).toHaveProperty("itglue_create_document");
    expect(handlers).toHaveProperty("itglue_update_document");
    expect(handlers).toHaveProperty("itglue_publish_document");
    expect(handlers).toHaveProperty("itglue_delete_documents");
  });

  describe("itglue_list_documents", () => {
    const handler = () => handlers["itglue_list_documents"];

    const emptyResult = {
      data: [],
      total_count: 0,
      page_number: 1,
      page_size: 50,
      has_more: false,
      next_page: null,
    };

    it("makes two getMany calls for root and folder documents", async () => {
      mockClient.getMany.mockResolvedValue(emptyResult);

      await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(mockClient.getMany).toHaveBeenCalledTimes(2);
    });

    it("uses org-scoped path for both calls", async () => {
      mockClient.getMany.mockResolvedValue(emptyResult);

      await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      const expectedPath = "/organizations/123/relationships/documents";
      expect(mockClient.getMany.mock.calls[0][0]).toBe(expectedPath);
      expect(mockClient.getMany.mock.calls[1][0]).toBe(expectedPath);
    });

    it("first call does not include folder filter", async () => {
      mockClient.getMany.mockResolvedValue(emptyResult);

      await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      const firstCallParams = mockClient.getMany.mock.calls[0][1];
      expect(firstCallParams).not.toHaveProperty(
        "filter[document-folder-id][ne]"
      );
    });

    it("second call includes folder filter param", async () => {
      mockClient.getMany.mockResolvedValue(emptyResult);

      await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      const secondCallParams = mockClient.getMany.mock.calls[1][1];
      expect(secondCallParams).toHaveProperty(
        "filter[document-folder-id][ne]",
        "null"
      );
    });

    it("browse mode: sends filter_id and sort (never filter[name]) to both calls", async () => {
      mockClient.getMany.mockResolvedValue({
        ...emptyResult,
        page_size: 25,
      });

      await handler()({
        organization_id: 123,
        filter_id: 5,
        sort: "-updated_at",
        page_number: 2,
        page_size: 25,
        response_format: "markdown",
      });

      const expectedBase = {
        "page[number]": 2,
        "page[size]": 25,
        "filter[id]": 5,
        sort: "-updated_at",
      };

      expect(mockClient.getMany.mock.calls[0][1]).toMatchObject(expectedBase);
      expect(mockClient.getMany.mock.calls[1][1]).toMatchObject(expectedBase);
      expect(mockClient.getMany.mock.calls[0][1]).not.toHaveProperty(
        "filter[name]"
      );
      expect(mockClient.getMany.mock.calls[1][1]).not.toHaveProperty(
        "filter[name]"
      );
    });

    it("search mode: uses getAll for root and folder, never sends filter[name]", async () => {
      mockClient.getAll.mockResolvedValue([]);

      await handler()({
        organization_id: 123,
        filter_name: "runbook",
        filter_id: 5,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(mockClient.getAll).toHaveBeenCalledTimes(2);
      expect(mockClient.getMany).not.toHaveBeenCalled();

      const rootParams = mockClient.getAll.mock.calls[0][1];
      const folderParams = mockClient.getAll.mock.calls[1][1];
      expect(rootParams).not.toHaveProperty("filter[document-folder-id][ne]");
      expect(folderParams).toHaveProperty(
        "filter[document-folder-id][ne]",
        "null"
      );
      expect(rootParams).not.toHaveProperty("filter[name]");
      expect(folderParams).not.toHaveProperty("filter[name]");
      expect(rootParams).toHaveProperty("filter[id]", 5);
    });

    it("combines results from both calls", async () => {
      mockClient.getMany
        .mockResolvedValueOnce({
          ...emptyResult,
          data: [
            { id: "1", name: "RootDoc", published: true, updated_at: "2024-01-01" },
          ],
          total_count: 1,
        })
        .mockResolvedValueOnce({
          ...emptyResult,
          data: [
            { id: "2", name: "FolderDoc", published: true, updated_at: "2024-01-01" },
          ],
          total_count: 1,
        });

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      const text = result.content[0].text;
      expect(text).toContain("RootDoc");
      expect(text).toContain("FolderDoc");
      expect(text).toContain("2 total");
    });

    it("deduplicates documents by id", async () => {
      mockClient.getMany
        .mockResolvedValueOnce({
          ...emptyResult,
          data: [{ id: "1", name: "SharedDoc" }],
          total_count: 1,
        })
        .mockResolvedValueOnce({
          ...emptyResult,
          data: [{ id: "1", name: "SharedDoc" }],
          total_count: 1,
        });

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(1);
    });

    it("reports has_more if either call has more", async () => {
      mockClient.getMany
        .mockResolvedValueOnce({
          data: [{ id: "1", name: "Doc1" }],
          total_count: 100,
          page_number: 1,
          page_size: 50,
          has_more: true,
          next_page: 2,
        })
        .mockResolvedValueOnce({
          data: [{ id: "2", name: "Doc2" }],
          total_count: 5,
          page_number: 1,
          page_size: 50,
          has_more: false,
          next_page: null,
        });

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.has_more).toBe(true);
      // Deduped row count for the page — not the double-counted 100 + 5.
      expect(parsed.total_count).toBe(2);
    });

    it("returns empty results message when both calls return no data", async () => {
      mockClient.getMany.mockResolvedValue(emptyResult);

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toContain("No documents found");
    });

    it("returns JSON format with combined data", async () => {
      mockClient.getMany.mockResolvedValue({
        ...emptyResult,
        data: [{ id: "1", name: "Doc1" }],
        total_count: 1,
      });

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(1);
    });

    it("search mode: filters merged docs by case-insensitive substring", async () => {
      mockClient.getAll
        .mockResolvedValueOnce([
          { id: "1", name: "Network Guide", published: true, updated_at: "2024-01-01" },
          { id: "2", name: "Billing Policy", published: true, updated_at: "2024-01-01" },
        ])
        .mockResolvedValueOnce([
          { id: "3", name: "VPN network setup", published: true, updated_at: "2024-01-01" },
        ]);

      const result = await handler()({
        organization_id: 123,
        filter_name: "NETWORK",
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      const text = result.content[0].text;
      expect(text).toContain("Network Guide");
      expect(text).toContain("VPN network setup");
      expect(text).not.toContain("Billing Policy");
      expect(text).toContain("2 total");
    });

    it("search mode: dedups across root and folder before matching", async () => {
      mockClient.getAll
        .mockResolvedValueOnce([{ id: "1", name: "Shared network doc" }])
        .mockResolvedValueOnce([{ id: "1", name: "Shared network doc" }]);

      const result = await handler()({
        organization_id: 123,
        filter_name: "network",
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.total_count).toBe(1);
    });

    it("search mode: paginates the filtered list client-side", async () => {
      const docs = Array.from({ length: 5 }, (_, i) => ({
        id: String(i + 1),
        name: `doc ${i + 1}`,
        published: true,
        updated_at: "2024-01-01",
      }));
      mockClient.getAll.mockResolvedValueOnce(docs).mockResolvedValueOnce([]);

      const result = await handler()({
        organization_id: 123,
        filter_name: "doc",
        page_number: 2,
        page_size: 2,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.map((d: { id: string }) => d.id)).toEqual(["3", "4"]);
      expect(parsed.total_count).toBe(5);
      expect(parsed.has_more).toBe(true);
      expect(parsed.next_page).toBe(3);
    });

    it("search mode: returns empty message when nothing matches", async () => {
      mockClient.getAll
        .mockResolvedValueOnce([{ id: "1", name: "Alpha" }])
        .mockResolvedValueOnce([]);

      const result = await handler()({
        organization_id: 123,
        filter_name: "zzz",
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toContain("No documents found");
    });
  });

  describe("itglue_get_document", () => {
    const handler = () => handlers["itglue_get_document"];

    it("fetches document and sections", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        name: "Test Doc",
        organization_name: "Acme",
        published: true,
        updated_at: "2024-06-01",
        resource_url: null,
      });
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1",
            resource_type: "Document::Text",
            sort: 0,
            content: "<p>Hello world</p>",
            updated_at: "2024-06-01",
          },
        ],
        total_count: 1,
        page_number: 1,
        page_size: 1000,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      expect(mockClient.getOne).toHaveBeenCalledWith("/documents/42");
      expect(mockClient.getMany).toHaveBeenCalledWith(
        "/documents/42/relationships/sections",
        { "page[size]": 1000 }
      );

      const text = result.content[0].text;
      expect(text).toContain("# Test Doc");
      expect(text).toContain("Hello world");
    });

    it("renders section content via stripHtml", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        name: "Doc",
        published: true,
        updated_at: "2024-01-01",
      });
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1",
            resource_type: "Document::Text",
            sort: 0,
            content: "<p>Line 1</p><p>Line 2</p>",
            updated_at: "2024-01-01",
          },
        ],
        total_count: 1,
        page_number: 1,
        page_size: 1000,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      const text = result.content[0].text;
      expect(text).toContain("Line 1");
      expect(text).toContain("Line 2");
      expect(text).not.toContain("<p>");
    });

    it("shows 'No sections' case", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        name: "Empty Doc",
        published: false,
        updated_at: "2024-01-01",
      });
      mockClient.getMany.mockResolvedValue({
        data: [],
        total_count: 0,
        page_number: 1,
        page_size: 1000,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      expect(result.content[0].text).toContain("No sections in this document");
    });

    it("returns JSON format with sections embedded", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        name: "Test",
        published: true,
        updated_at: "2024-01-01",
      });
      mockClient.getMany.mockResolvedValue({
        data: [{ id: "1", content: "<p>test</p>" }],
        total_count: 1,
        page_number: 1,
        page_size: 1000,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        document_id: 42,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.sections).toHaveLength(1);
      expect(parsed.id).toBe("42");
    });

    it("returns isError on failure", async () => {
      mockClient.getOne.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        document_id: 999,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("itglue_create_document", () => {
    const handler = () => handlers["itglue_create_document"];

    it("serializes body correctly", async () => {
      mockClient.post.mockResolvedValue({
        id: "99",
        name: "New Runbook",
        published: false,
        created_at: "2024-06-01",
      });

      await handler()({
        organization_id: 123,
        name: "New Runbook",
        response_format: "markdown",
      });

      const body = mockClient.post.mock.calls[0][1];
      expect(body.data.type).toBe("documents");
      expect(body.data.attributes).toHaveProperty("name", "New Runbook");
      expect(body.data.attributes).toHaveProperty("organization-id", 123);
    });

    it("returns 'Next steps' guidance in markdown", async () => {
      mockClient.post.mockResolvedValue({
        id: "99",
        name: "New Doc",
        published: false,
        created_at: "2024-06-01",
      });

      const result = await handler()({
        organization_id: 123,
        name: "New Doc",
        response_format: "markdown",
      });

      const text = result.content[0].text;
      expect(text).toContain("Document Created");
      expect(text).toContain("Next steps");
      expect(text).toContain("itglue_create_document_section");
      expect(text).toContain("itglue_publish_document");
    });

    it("returns JSON format", async () => {
      mockClient.post.mockResolvedValue({
        id: "99",
        name: "New Doc",
      });

      const result = await handler()({
        organization_id: 123,
        name: "New Doc",
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("99");
    });
  });

  describe("itglue_update_document", () => {
    const handler = () => handlers["itglue_update_document"];

    it("only includes provided attributes", async () => {
      mockClient.patch.mockResolvedValue({
        id: "42",
        name: "Renamed",
        organization_name: "Acme",
        published: true,
        updated_at: "2024-06-01",
      });

      await handler()({
        document_id: 42,
        name: "Renamed",
        response_format: "markdown",
      });

      const body = mockClient.patch.mock.calls[0][1];
      expect(body.data.attributes).toHaveProperty("name", "Renamed");
      expect(body.data.id).toBe("42");
    });

    it("calls patch with correct path", async () => {
      mockClient.patch.mockResolvedValue({
        id: "42",
        name: "Updated",
        updated_at: "2024-06-01",
      });

      await handler()({
        document_id: 42,
        name: "Updated",
        response_format: "markdown",
      });

      expect(mockClient.patch).toHaveBeenCalledWith(
        "/documents/42",
        expect.any(Object)
      );
    });
  });

  describe("itglue_publish_document", () => {
    const handler = () => handlers["itglue_publish_document"];

    it("calls patchAction with correct path", async () => {
      mockClient.patchAction.mockResolvedValue(null);

      await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      expect(mockClient.patchAction).toHaveBeenCalledWith(
        "/documents/42/publish"
      );
    });

    it("does not call postAction", async () => {
      mockClient.patchAction.mockResolvedValue(null);

      await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      expect(mockClient.postAction).not.toHaveBeenCalled();
    });

    it("returns success message in markdown", async () => {
      mockClient.patchAction.mockResolvedValue(null);

      const result = await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      expect(result.content[0].text).toContain("published successfully");
    });

    it("returns JSON format", async () => {
      mockClient.patchAction.mockResolvedValue(null);

      const result = await handler()({
        document_id: 42,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.document_id).toBe(42);
    });
  });

  describe("itglue_delete_documents", () => {
    const handler = () => handlers["itglue_delete_documents"];

    it("uses serializeDeleteBody format", async () => {
      mockClient.delete.mockResolvedValue(undefined);

      await handler()({ document_ids: [1, 2, 3] });

      const body = mockClient.delete.mock.calls[0][1];
      expect(body.data).toHaveLength(3);
      expect(body.data[0]).toEqual({
        type: "documents",
        attributes: { id: 1 },
      });
    });

    it("returns confirmation with IDs", async () => {
      mockClient.delete.mockResolvedValue(undefined);

      const result = await handler()({ document_ids: [10, 20] });

      const text = result.content[0].text;
      expect(text).toContain("Successfully deleted");
      expect(text).toContain("10");
      expect(text).toContain("20");
    });

    it("returns isError on failure", async () => {
      mockClient.delete.mockRejectedValue(new Error("Not found"));

      const result = await handler()({ document_ids: [999] });

      expect(result.isError).toBe(true);
    });
  });
});
