import { describe, it, expect, beforeEach } from "vitest";
import { registerOrganizationTools } from "./organizations.js";
import { makeMockClient, makeMockServer } from "../test-helpers.js";
import type { ITGlueOrganization, PaginatedResult } from "../types.js";

// Phase 0 golden snapshots: lock the CURRENT verbatim output of every
// organizations tool path so a later factory refactor stays byte-identical.
// All mock data is hard-coded (ids, names, timestamps) for determinism.

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("organizations tools (golden snapshots)", () => {
  let mockServer: ReturnType<typeof makeMockServer>;
  let mockClient: ReturnType<typeof makeMockClient>;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockServer = makeMockServer();
    mockClient = makeMockClient();
    registerOrganizationTools(mockServer as never, mockClient as never);

    handlers = {};
    for (const call of mockServer.registerTool.mock.calls) {
      handlers[call[0] as string] = call[2] as ToolHandler;
    }
  });

  describe("itglue_list_organizations", () => {
    const handler = () => handlers["itglue_list_organizations"];

    it("markdown: multiple orgs with all optional fields, has_more:false", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1",
            type: "organizations",
            name: "Acme Corp",
            description: "A great company",
            organization_type_name: "Customer",
            organization_status_name: "Active",
            short_name: "acme",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "2",
            type: "organizations",
            name: "Beta LLC",
            description: "Another company",
            organization_type_name: "Vendor",
            organization_status_name: "Inactive",
            short_name: "beta",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
        ],
        total_count: 2,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      } satisfies PaginatedResult<ITGlueOrganization>);

      const result = await handler()({
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Organizations (2 total)

        ## Acme Corp (ID: 1)
        A great company
        - **Type**: Customer
        - **Status**: Active
        - **Short Name**: acme
        - **Updated**: 2024-06-01T00:00:00.000Z

        ## Beta LLC (ID: 2)
        Another company
        - **Type**: Vendor
        - **Status**: Inactive
        - **Short Name**: beta
        - **Updated**: 2024-06-02T00:00:00.000Z

        ---
        Page 1 | 2 total results"
      `);
    });

    it("markdown: multiple orgs with all optional fields, has_more:true", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1",
            type: "organizations",
            name: "Acme Corp",
            description: "A great company",
            organization_type_name: "Customer",
            organization_status_name: "Active",
            short_name: "acme",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "2",
            type: "organizations",
            name: "Beta LLC",
            description: "Another company",
            organization_type_name: "Vendor",
            organization_status_name: "Inactive",
            short_name: "beta",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
        ],
        total_count: 100,
        page_number: 1,
        page_size: 50,
        has_more: true,
        next_page: 2,
      } satisfies PaginatedResult<ITGlueOrganization>);

      const result = await handler()({
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Organizations (100 total)

        ## Acme Corp (ID: 1)
        A great company
        - **Type**: Customer
        - **Status**: Active
        - **Short Name**: acme
        - **Updated**: 2024-06-01T00:00:00.000Z

        ## Beta LLC (ID: 2)
        Another company
        - **Type**: Vendor
        - **Status**: Inactive
        - **Short Name**: beta
        - **Updated**: 2024-06-02T00:00:00.000Z

        ---
        Page 1 | 100 total results
        More results available — use page_number: 2 to see next page"
      `);
    });

    it("json: multiple orgs", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1",
            type: "organizations",
            name: "Acme Corp",
            description: "A great company",
            organization_type_name: "Customer",
            organization_status_name: "Active",
            short_name: "acme",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "2",
            type: "organizations",
            name: "Beta LLC",
            description: "Another company",
            organization_type_name: "Vendor",
            organization_status_name: "Inactive",
            short_name: "beta",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
        ],
        total_count: 2,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      } satisfies PaginatedResult<ITGlueOrganization>);

      const result = await handler()({
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "data": [
            {
              "id": "1",
              "type": "organizations",
              "name": "Acme Corp",
              "description": "A great company",
              "organization_type_name": "Customer",
              "organization_status_name": "Active",
              "short_name": "acme",
              "updated_at": "2024-06-01T00:00:00.000Z"
            },
            {
              "id": "2",
              "type": "organizations",
              "name": "Beta LLC",
              "description": "Another company",
              "organization_type_name": "Vendor",
              "organization_status_name": "Inactive",
              "short_name": "beta",
              "updated_at": "2024-06-02T00:00:00.000Z"
            }
          ],
          "total_count": 2,
          "page_number": 1,
          "page_size": 50,
          "has_more": false,
          "next_page": null
        }"
      `);
    });

    it("empty result message", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [],
        total_count: 0,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      } satisfies PaginatedResult<ITGlueOrganization>);

      const result = await handler()({
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`"No organizations found matching the specified filters."`);
    });

    it("isError when the client rejects", async () => {
      mockClient.getMany.mockRejectedValue(new Error("Network error"));

      const result = await handler()({
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Network error"`);
    });
  });

  describe("itglue_get_organization", () => {
    const handler = () => handlers["itglue_get_organization"];

    it("markdown: all optional fields present", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        type: "organizations",
        name: "Acme Corp",
        description: "A great company",
        short_name: "acme",
        organization_type_name: "Customer",
        organization_status_name: "Active",
        primary: true,
        alert: "Important alert",
        quick_notes: "Some notes",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        organization_id: 42,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Acme Corp

        **ID**: 42
        **Description**: A great company
        **Short Name**: acme
        **Type**: Customer
        **Status**: Active
        **Primary**: Yes

        > **Alert**: Important alert

        **Quick Notes**: Some notes

        - **Created**: 2024-01-01T00:00:00.000Z
        - **Updated**: 2024-06-01T00:00:00.000Z"
      `);
    });

    it("markdown: minimal org with optional fields null/absent", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "7",
        type: "organizations",
        name: "Minimal Org",
        description: null,
        short_name: null,
        organization_type_name: null,
        organization_status_name: null,
        primary: false,
        alert: null,
        quick_notes: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        organization_id: 7,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Minimal Org

        **ID**: 7

        - **Created**: 2024-01-01T00:00:00.000Z
        - **Updated**: 2024-06-01T00:00:00.000Z"
      `);
    });

    it("json: all optional fields present", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        type: "organizations",
        name: "Acme Corp",
        description: "A great company",
        short_name: "acme",
        organization_type_name: "Customer",
        organization_status_name: "Active",
        primary: true,
        alert: "Important alert",
        quick_notes: "Some notes",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        organization_id: 42,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "id": "42",
          "type": "organizations",
          "name": "Acme Corp",
          "description": "A great company",
          "short_name": "acme",
          "organization_type_name": "Customer",
          "organization_status_name": "Active",
          "primary": true,
          "alert": "Important alert",
          "quick_notes": "Some notes",
          "created_at": "2024-01-01T00:00:00.000Z",
          "updated_at": "2024-06-01T00:00:00.000Z"
        }"
      `);
    });

    it("isError when the client rejects", async () => {
      mockClient.getOne.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        organization_id: 999,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });
});
