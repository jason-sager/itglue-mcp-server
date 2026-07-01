import { describe, it, expect, beforeEach } from "vitest";
import { registerDocumentTools } from "./documents.js";
import { makeMockClient, makeMockServer } from "../test-helpers.js";

// ─────────────────────────────────────────────────────────────────
// Phase 0 golden snapshots for the documents tool group.
//
// These lock the CURRENT verbatim output of every handler so a later
// factory refactor can be proven byte-identical. Every mock return
// value is hard-coded (fixed ids, names, ISO timestamps) so the
// snapshots are fully deterministic.
// ─────────────────────────────────────────────────────────────────

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("documents tool snapshots", () => {
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

  // ─── itglue_list_documents ───────────────────────────────────────
  describe("itglue_list_documents", () => {
    const handler = () => handlers["itglue_list_documents"];

    const emptyPage = {
      data: [],
      total_count: 0,
      page_number: 1,
      page_size: 50,
      has_more: false,
      next_page: null,
    };

    it("browse mode: markdown (root + folder merged)", async () => {
      mockClient.getMany
        .mockResolvedValueOnce({
          ...emptyPage,
          data: [
            {
              id: "1",
              name: "Root Runbook",
              organization_name: "Acme Corp",
              published: true,
              updated_at: "2024-06-01T00:00:00.000Z",
              resource_url: "https://app.itglue.com/docs/1",
            },
          ],
          total_count: 1,
          has_more: false,
        })
        .mockResolvedValueOnce({
          ...emptyPage,
          data: [
            {
              id: "2",
              name: "Folder Guide",
              organization_name: "Acme Corp",
              published: false,
              updated_at: "2024-06-02T00:00:00.000Z",
              resource_url: null,
            },
          ],
          total_count: 1,
          has_more: false,
        });

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Documents (2 total)

        ## Root Runbook (ID: 1)
        - **Organization**: Acme Corp
        - **Published**: Yes
        - **Updated**: 2024-06-01T00:00:00.000Z
        - **URL**: https://app.itglue.com/docs/1

        ## Folder Guide (ID: 2)
        - **Organization**: Acme Corp
        - **Published**: No
        - **Updated**: 2024-06-02T00:00:00.000Z

        ---
        Page 1 | 2 total results"
      `);
    });

    it("browse mode: markdown with pagination footer (has_more)", async () => {
      mockClient.getMany
        .mockResolvedValueOnce({
          ...emptyPage,
          data: [
            {
              id: "1",
              name: "Root Runbook",
              organization_name: "Acme Corp",
              published: true,
              updated_at: "2024-06-01T00:00:00.000Z",
              resource_url: "https://app.itglue.com/docs/1",
            },
          ],
          total_count: 100,
          has_more: true,
          next_page: 2,
        })
        .mockResolvedValueOnce({
          ...emptyPage,
          data: [
            {
              id: "2",
              name: "Folder Guide",
              organization_name: "Acme Corp",
              published: true,
              updated_at: "2024-06-02T00:00:00.000Z",
              resource_url: null,
            },
          ],
          total_count: 5,
          has_more: false,
        });

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Documents (2 total)

        ## Root Runbook (ID: 1)
        - **Organization**: Acme Corp
        - **Published**: Yes
        - **Updated**: 2024-06-01T00:00:00.000Z
        - **URL**: https://app.itglue.com/docs/1

        ## Folder Guide (ID: 2)
        - **Organization**: Acme Corp
        - **Published**: Yes
        - **Updated**: 2024-06-02T00:00:00.000Z

        ---
        Page 1 | 2 total results
        More results available — use page_number: 2 to see next page"
      `);
    });

    it("search mode: markdown (substring match + client pagination)", async () => {
      mockClient.getAll
        .mockResolvedValueOnce([
          {
            id: "1",
            name: "Network Guide",
            organization_name: "Acme Corp",
            published: true,
            updated_at: "2024-06-01T00:00:00.000Z",
            resource_url: "https://app.itglue.com/docs/1",
          },
          {
            id: "2",
            name: "Billing Policy",
            organization_name: "Acme Corp",
            published: true,
            updated_at: "2024-06-02T00:00:00.000Z",
            resource_url: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "3",
            name: "VPN network setup",
            organization_name: "Acme Corp",
            published: false,
            updated_at: "2024-06-03T00:00:00.000Z",
            resource_url: null,
          },
        ]);

      const result = await handler()({
        organization_id: 123,
        filter_name: "NETWORK",
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Documents (2 total)

        ## Network Guide (ID: 1)
        - **Organization**: Acme Corp
        - **Published**: Yes
        - **Updated**: 2024-06-01T00:00:00.000Z
        - **URL**: https://app.itglue.com/docs/1

        ## VPN network setup (ID: 3)
        - **Organization**: Acme Corp
        - **Published**: No
        - **Updated**: 2024-06-03T00:00:00.000Z

        ---
        Page 1 | 2 total results"
      `);
    });

    it("search mode: markdown paginated page 2 (has_more footer)", async () => {
      const docs = Array.from({ length: 5 }, (_, i) => ({
        id: String(i + 1),
        name: `network doc ${i + 1}`,
        organization_name: "Acme Corp",
        published: true,
        updated_at: "2024-06-01T00:00:00.000Z",
        resource_url: null,
      }));
      mockClient.getAll.mockResolvedValueOnce(docs).mockResolvedValueOnce([]);

      const result = await handler()({
        organization_id: 123,
        filter_name: "network",
        page_number: 2,
        page_size: 2,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Documents (5 total)

        ## network doc 3 (ID: 3)
        - **Organization**: Acme Corp
        - **Published**: Yes
        - **Updated**: 2024-06-01T00:00:00.000Z

        ## network doc 4 (ID: 4)
        - **Organization**: Acme Corp
        - **Published**: Yes
        - **Updated**: 2024-06-01T00:00:00.000Z

        ---
        Page 2 | 5 total results
        More results available — use page_number: 3 to see next page"
      `);
    });

    it("browse mode: JSON", async () => {
      mockClient.getMany
        .mockResolvedValueOnce({
          ...emptyPage,
          data: [
            {
              id: "1",
              name: "Root Runbook",
              organization_name: "Acme Corp",
              published: true,
              updated_at: "2024-06-01T00:00:00.000Z",
              resource_url: "https://app.itglue.com/docs/1",
            },
          ],
          total_count: 1,
          has_more: true,
          next_page: 2,
        })
        .mockResolvedValueOnce({ ...emptyPage, has_more: false });

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "data": [
            {
              "id": "1",
              "name": "Root Runbook",
              "organization_name": "Acme Corp",
              "published": true,
              "updated_at": "2024-06-01T00:00:00.000Z",
              "resource_url": "https://app.itglue.com/docs/1"
            }
          ],
          "total_count": 1,
          "page_number": 1,
          "page_size": 50,
          "has_more": true,
          "next_page": 2
        }"
      `);
    });

    it("search mode: JSON (paginated page 2)", async () => {
      const docs = Array.from({ length: 5 }, (_, i) => ({
        id: String(i + 1),
        name: `network doc ${i + 1}`,
        organization_name: "Acme Corp",
        published: true,
        updated_at: "2024-06-01T00:00:00.000Z",
        resource_url: null,
      }));
      mockClient.getAll.mockResolvedValueOnce(docs).mockResolvedValueOnce([]);

      const result = await handler()({
        organization_id: 123,
        filter_name: "network",
        page_number: 2,
        page_size: 2,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "data": [
            {
              "id": "3",
              "name": "network doc 3",
              "organization_name": "Acme Corp",
              "published": true,
              "updated_at": "2024-06-01T00:00:00.000Z",
              "resource_url": null
            },
            {
              "id": "4",
              "name": "network doc 4",
              "organization_name": "Acme Corp",
              "published": true,
              "updated_at": "2024-06-01T00:00:00.000Z",
              "resource_url": null
            }
          ],
          "total_count": 5,
          "page_number": 2,
          "page_size": 2,
          "has_more": true,
          "next_page": 3
        }"
      `);
    });

    it("empty results message (browse mode, no data)", async () => {
      mockClient.getMany.mockResolvedValue(emptyPage);

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`"No documents found matching the specified filters."`);
    });

    it("isError on failure", async () => {
      mockClient.getMany.mockRejectedValue(new Error("boom"));

      const result = await handler()({
        organization_id: 123,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: boom"`);
    });
  });

  // ─── itglue_get_document ─────────────────────────────────────────
  describe("itglue_get_document", () => {
    const handler = () => handlers["itglue_get_document"];

    it("markdown with embedded sections", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        name: "Test Doc",
        organization_name: "Acme Corp",
        published: true,
        updated_at: "2024-06-01T00:00:00.000Z",
        resource_url: "https://app.itglue.com/docs/42",
      });
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "10",
            resource_type: "Document::Heading",
            sort: 0,
            level: 1,
            content: "<h1>Overview</h1>",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "11",
            resource_type: "Document::Text",
            sort: 1,
            content: "<p>Line 1</p><p>Line 2</p>",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "12",
            resource_type: "Document::Step",
            sort: 2,
            content: "<p>Restart the service</p>",
            duration: 5,
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "13",
            resource_type: "Document::Gallery",
            sort: 3,
            content: null,
            updated_at: "2024-06-01T00:00:00.000Z",
          },
        ],
        total_count: 4,
        page_number: 1,
        page_size: 1000,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Test Doc

        **ID**: 42
        **Organization**: Acme Corp
        **Published**: Yes
        **Updated**: 2024-06-01T00:00:00.000Z
        **URL**: https://app.itglue.com/docs/42

        ## Sections (4)

        ### Heading Section (ID: 10, Position: 0)
        **Level**: 1
        # Overview

        ### Text Section (ID: 11, Position: 1)
        Line 1

        Line 2

        ### Step Section (ID: 12, Position: 2)
        Restart the service
        - **Duration**: 5 min

        ### Gallery Section (ID: 13, Position: 3)
        *No content*
        "
      `);
    });

    it("markdown with no sections", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        name: "Empty Doc",
        published: false,
        updated_at: "2024-06-01T00:00:00.000Z",
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

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Empty Doc

        **ID**: 42
        **Published**: No
        **Updated**: 2024-06-01T00:00:00.000Z

        *No sections in this document.*"
      `);
    });

    it("JSON with sections embedded", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        name: "Test Doc",
        organization_name: "Acme Corp",
        published: true,
        updated_at: "2024-06-01T00:00:00.000Z",
        resource_url: "https://app.itglue.com/docs/42",
      });
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "10",
            resource_type: "Document::Text",
            sort: 0,
            content: "<p>test</p>",
            updated_at: "2024-06-01T00:00:00.000Z",
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
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "id": "42",
          "name": "Test Doc",
          "organization_name": "Acme Corp",
          "published": true,
          "updated_at": "2024-06-01T00:00:00.000Z",
          "resource_url": "https://app.itglue.com/docs/42",
          "sections": [
            {
              "id": "10",
              "resource_type": "Document::Text",
              "sort": 0,
              "content": "<p>test</p>",
              "updated_at": "2024-06-01T00:00:00.000Z"
            }
          ]
        }"
      `);
    });

    it("isError on failure", async () => {
      mockClient.getOne.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        document_id: 999,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });

  // ─── itglue_create_document ──────────────────────────────────────
  describe("itglue_create_document", () => {
    const handler = () => handlers["itglue_create_document"];

    it("markdown confirmation", async () => {
      mockClient.post.mockResolvedValue({
        id: "99",
        name: "Server Maintenance Runbook",
        published: false,
        created_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        organization_id: 123,
        name: "Server Maintenance Runbook",
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Document Created

        **ID**: 99
        **Name**: Server Maintenance Runbook
        **Published**: No (draft)
        **Created**: 2024-06-01T00:00:00.000Z

        Next steps:
        - Use \`itglue_create_document_section\` to add content
        - Use \`itglue_publish_document\` to publish when ready"
      `);
    });

    it("JSON", async () => {
      mockClient.post.mockResolvedValue({
        id: "99",
        name: "Server Maintenance Runbook",
        organization_name: "Acme Corp",
        published: false,
        created_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        organization_id: 123,
        name: "Server Maintenance Runbook",
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "id": "99",
          "name": "Server Maintenance Runbook",
          "organization_name": "Acme Corp",
          "published": false,
          "created_at": "2024-06-01T00:00:00.000Z"
        }"
      `);
    });

    it("isError on failure", async () => {
      mockClient.post.mockRejectedValue(new Error("Validation failed"));

      const result = await handler()({
        organization_id: 123,
        name: "Bad Doc",
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Validation failed"`);
    });
  });

  // ─── itglue_update_document ──────────────────────────────────────
  describe("itglue_update_document", () => {
    const handler = () => handlers["itglue_update_document"];

    it("markdown confirmation", async () => {
      mockClient.patch.mockResolvedValue({
        id: "42",
        name: "Renamed Runbook",
        organization_name: "Acme Corp",
        published: true,
        updated_at: "2024-06-01T00:00:00.000Z",
        resource_url: "https://app.itglue.com/docs/42",
      });

      const result = await handler()({
        document_id: 42,
        name: "Renamed Runbook",
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "Document updated successfully.

        ## Renamed Runbook (ID: 42)
        - **Organization**: Acme Corp
        - **Published**: Yes
        - **Updated**: 2024-06-01T00:00:00.000Z
        - **URL**: https://app.itglue.com/docs/42
        "
      `);
    });

    it("JSON", async () => {
      mockClient.patch.mockResolvedValue({
        id: "42",
        name: "Renamed Runbook",
        organization_name: "Acme Corp",
        published: true,
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        document_id: 42,
        name: "Renamed Runbook",
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "id": "42",
          "name": "Renamed Runbook",
          "organization_name": "Acme Corp",
          "published": true,
          "updated_at": "2024-06-01T00:00:00.000Z"
        }"
      `);
    });

    it("isError on failure", async () => {
      mockClient.patch.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        document_id: 999,
        name: "X",
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });

  // ─── itglue_publish_document ─────────────────────────────────────
  describe("itglue_publish_document", () => {
    const handler = () => handlers["itglue_publish_document"];

    it("markdown confirmation", async () => {
      mockClient.patchAction.mockResolvedValue(null);

      const result = await handler()({
        document_id: 42,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`"Document 42 published successfully."`);
    });

    it("JSON", async () => {
      mockClient.patchAction.mockResolvedValue(null);

      const result = await handler()({
        document_id: 42,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "success": true,
          "document_id": 42,
          "message": "Document published successfully"
        }"
      `);
    });

    it("isError on failure", async () => {
      mockClient.patchAction.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        document_id: 999,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });

  // ─── itglue_delete_documents ─────────────────────────────────────
  describe("itglue_delete_documents", () => {
    const handler = () => handlers["itglue_delete_documents"];

    it("single id", async () => {
      mockClient.delete.mockResolvedValue(undefined);

      const result = await handler()({ document_ids: [456] });

      expect(result.content[0].text).toMatchInlineSnapshot(`"Successfully deleted 1 document(s): 456"`);
    });

    it("multiple ids", async () => {
      mockClient.delete.mockResolvedValue(undefined);

      const result = await handler()({ document_ids: [100, 200, 300] });

      expect(result.content[0].text).toMatchInlineSnapshot(`"Successfully deleted 3 document(s): 100, 200, 300"`);
    });

    it("isError on failure", async () => {
      mockClient.delete.mockRejectedValue(new Error("Not found"));

      const result = await handler()({ document_ids: [999] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });
});
