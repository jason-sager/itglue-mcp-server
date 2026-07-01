import { describe, it, expect, beforeEach } from "vitest";
import { registerDocumentSectionTools } from "./document-sections.js";
import { makeMockClient, makeMockServer } from "../test-helpers.js";

// Phase 0 golden snapshots: lock the CURRENT verbatim output of every
// document-section tool so a later factory refactor can be proven
// byte-identical. All mock return values are hard-coded (fixed ids,
// timestamps, sizes) so every snapshot is fully deterministic.

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("document-sections golden snapshots", () => {
  let mockServer: ReturnType<typeof makeMockServer>;
  let mockClient: ReturnType<typeof makeMockClient>;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockServer = makeMockServer();
    mockClient = makeMockClient();
    registerDocumentSectionTools(mockServer as never, mockClient as never);

    handlers = {};
    for (const call of mockServer.registerTool.mock.calls) {
      handlers[call[0] as string] = call[2] as ToolHandler;
    }
  });

  describe("itglue_list_document_sections", () => {
    const handler = () => handlers["itglue_list_document_sections"];

    it("markdown: multiple sections (Text/Heading/Gallery/Step) with pagination footer", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1001",
            document_id: 456,
            resource_type: "Document::Heading",
            level: 2,
            sort: 0,
            content: "<h2>Overview</h2>",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "1002",
            document_id: 456,
            resource_type: "Document::Text",
            sort: 1,
            content: "<p>First paragraph.</p><p>Second paragraph.</p>",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
          {
            id: "1003",
            document_id: 456,
            resource_type: "Document::Gallery",
            sort: 2,
            content: null,
            updated_at: "2024-06-03T00:00:00.000Z",
          },
          {
            id: "1004",
            document_id: 456,
            resource_type: "Document::Step",
            sort: 3,
            content: "<p>Install the application.</p>",
            duration: 5,
            updated_at: "2024-06-04T00:00:00.000Z",
          },
        ],
        total_count: 8,
        page_number: 1,
        page_size: 50,
        has_more: true,
        next_page: 2,
      });

      const result = await handler()({
        document_id: 456,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Document Sections (8 total)

        ### Heading Section (ID: 1001, Position: 0)
        **Level**: 2
        ## Overview
        - **Updated**: 2024-06-01T00:00:00.000Z

        ### Text Section (ID: 1002, Position: 1)
        First paragraph.

        Second paragraph.
        - **Updated**: 2024-06-02T00:00:00.000Z

        ### Gallery Section (ID: 1003, Position: 2)
        *No content*
        - **Updated**: 2024-06-03T00:00:00.000Z

        ### Step Section (ID: 1004, Position: 3)
        Install the application.
        - **Duration**: 5 min
        - **Updated**: 2024-06-04T00:00:00.000Z

        ---
        Page 1 | 8 total results
        More results available — use page_number: 2 to see next page"
      `);
    });

    it("json: raw serialized result", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1001",
            document_id: 456,
            resource_type: "Document::Text",
            sort: 0,
            content: "<p>Hello world</p>",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
        ],
        total_count: 1,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        document_id: 456,
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "data": [
            {
              "id": "1001",
              "document_id": 456,
              "resource_type": "Document::Text",
              "sort": 0,
              "content": "<p>Hello world</p>",
              "updated_at": "2024-06-01T00:00:00.000Z"
            }
          ],
          "total_count": 1,
          "page_number": 1,
          "page_size": 50,
          "has_more": false,
          "next_page": null
        }"
      `);
    });

    it("empty: no sections found", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [],
        total_count: 0,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        document_id: 456,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`"No sections found in this document."`);
    });

    it("isError: client rejects", async () => {
      mockClient.getMany.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        document_id: 999,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });

  describe("itglue_get_document_section", () => {
    const handler = () => handlers["itglue_get_document_section"];

    it("markdown: full content with level and duration", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "789",
        document_id: 456,
        resource_type: "Document::Step",
        level: 3,
        sort: 2,
        duration: 10,
        content:
          "<h3>Configure the server</h3><p>Open the console.</p><ul><li>First</li><li>Second</li></ul>",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        document_id: 456,
        section_id: 789,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Step Section (ID: 789)

        **Document ID**: 456
        **Position**: 2
        **Level**: 3
        **Duration**: 10 min
        **Updated**: 2024-06-01T00:00:00.000Z

        ## Content

        ### Configure the server
        Open the console.

        - First
        - Second
        "
      `);
    });

    it("json: raw serialized section", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "789",
        document_id: 456,
        resource_type: "Document::Text",
        sort: 0,
        content: "<p>Hello world</p>",
        rendered_content: "<p>Hello world</p>",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        document_id: 456,
        section_id: 789,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "id": "789",
          "document_id": 456,
          "resource_type": "Document::Text",
          "sort": 0,
          "content": "<p>Hello world</p>",
          "rendered_content": "<p>Hello world</p>",
          "updated_at": "2024-06-01T00:00:00.000Z"
        }"
      `);
    });

    it("isError: client rejects", async () => {
      mockClient.getOne.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        document_id: 456,
        section_id: 999,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });

  describe("itglue_create_document_section", () => {
    const handler = () => handlers["itglue_create_document_section"];

    it("markdown: confirmation output", async () => {
      mockClient.post.mockResolvedValue({
        id: "99",
        document_id: 456,
        resource_type: "Document::Heading",
        level: 2,
        sort: 4,
        created_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        document_id: 456,
        section_type: "Heading",
        content: "Overview",
        level: 2,
        sort: 4,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Section Created

        **ID**: 99
        **Type**: Heading
        **Document ID**: 456
        **Position**: 4
        **Created**: 2024-06-01T00:00:00.000Z"
      `);
    });

    it("isError: client rejects", async () => {
      mockClient.post.mockRejectedValue(new Error("Failed"));

      const result = await handler()({
        document_id: 456,
        section_type: "Text",
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Failed"`);
    });
  });

  describe("itglue_update_document_section", () => {
    const handler = () => handlers["itglue_update_document_section"];

    it("markdown: confirmation output", async () => {
      mockClient.patch.mockResolvedValue({
        id: "789",
        document_id: 456,
        resource_type: "Document::Text",
        sort: 1,
        content: "<p>Updated content.</p>",
        updated_at: "2024-06-05T00:00:00.000Z",
      });

      const result = await handler()({
        document_id: 456,
        section_id: 789,
        content: "<p>Updated content.</p>",
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "Section updated successfully.

        ### Text Section (ID: 789, Position: 1)
        Updated content.
        - **Updated**: 2024-06-05T00:00:00.000Z
        "
      `);
    });

    it("isError: client rejects", async () => {
      mockClient.patch.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        document_id: 456,
        section_id: 999,
        content: "<p>Updated content.</p>",
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });

  describe("itglue_delete_document_section", () => {
    const handler = () => handlers["itglue_delete_document_section"];

    it("markdown: confirmation output", async () => {
      mockClient.delete.mockResolvedValue(undefined);

      const result = await handler()({ document_id: 456, section_id: 789 });

      expect(result.content[0].text).toMatchInlineSnapshot(`"Successfully deleted section 789."`);
    });

    it("isError: client rejects", async () => {
      mockClient.delete.mockRejectedValue(new Error("Not found"));

      const result = await handler()({ document_id: 456, section_id: 999 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });
});
