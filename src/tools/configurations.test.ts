import { describe, it, expect, beforeEach } from "vitest";
import { registerConfigurationTools } from "./configurations.js";
import { makeMockClient, makeMockServer } from "../test-helpers.js";
import type { ITGlueConfiguration, PaginatedResult } from "../types.js";

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("registerConfigurationTools", () => {
  let mockServer: ReturnType<typeof makeMockServer>;
  let mockClient: ReturnType<typeof makeMockClient>;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    mockServer = makeMockServer();
    mockClient = makeMockClient();
    registerConfigurationTools(mockServer as never, mockClient as never);

    handlers = {};
    for (const call of mockServer.registerTool.mock.calls) {
      handlers[call[0] as string] = call[2] as ToolHandler;
    }
  });

  it("registers exactly 2 tools", () => {
    expect(mockServer.registerTool).toHaveBeenCalledTimes(2);
    expect(handlers).toHaveProperty("itglue_list_configurations");
    expect(handlers).toHaveProperty("itglue_get_configuration");
  });

  describe("itglue_list_configurations", () => {
    const handler = () => handlers["itglue_list_configurations"];

    it("browse mode: calls getMany with the org-scoped path and pagination", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [],
        total_count: 0,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      } satisfies PaginatedResult<ITGlueConfiguration>);

      await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(mockClient.getMany).toHaveBeenCalledWith(
        "/organizations/99/relationships/configurations",
        {
          "page[number]": 1,
          "page[size]": 50,
        }
      );
      expect(mockClient.getAll).not.toHaveBeenCalled();
    });

    it("browse mode: forwards server-side type/status filters", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [],
        total_count: 0,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      } satisfies PaginatedResult<ITGlueConfiguration>);

      await handler()({
        organization_id: 99,
        filter_configuration_type_id: 3,
        filter_configuration_status_id: 5,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(mockClient.getMany).toHaveBeenCalledWith(
        "/organizations/99/relationships/configurations",
        {
          "page[number]": 1,
          "page[size]": 50,
          "filter[configuration-type-id]": 3,
          "filter[configuration-status-id]": 5,
        }
      );
      expect(mockClient.getAll).not.toHaveBeenCalled();
    });

    it("search mode: uses getAll once on the org path and never sends filter[name]", async () => {
      mockClient.getAll.mockResolvedValue([
        {
          id: "1",
          name: "Edge Firewall",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "2",
          name: "Core Switch",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ]);

      const result = await handler()({
        organization_id: 99,
        filter_name: "firewall",
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(mockClient.getAll).toHaveBeenCalledTimes(1);
      expect(mockClient.getAll.mock.calls[0][0]).toBe(
        "/organizations/99/relationships/configurations"
      );
      expect(mockClient.getAll.mock.calls[0][1]).not.toHaveProperty(
        "filter[name]"
      );
      expect(mockClient.getMany).not.toHaveBeenCalled();

      const text = result.content[0].text;
      expect(text).toContain("Edge Firewall");
      expect(text).not.toContain("Core Switch");
      expect(text).toContain("1 total");
    });

    it("search mode: paginates the filtered list client-side (page 2 size 2 over 5 matches)", async () => {
      const configs = Array.from({ length: 5 }, (_, i) => ({
        id: String(i + 1),
        name: `Firewall ${i + 1}`,
        updated_at: "2024-01-01T00:00:00.000Z",
      }));
      mockClient.getAll.mockResolvedValue(configs);

      const result = await handler()({
        organization_id: 99,
        filter_name: "firewall",
        page_number: 2,
        page_size: 2,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.map((c: { id: string }) => c.id)).toEqual(["3", "4"]);
      expect(parsed.total_count).toBe(5);
      expect(parsed.has_more).toBe(true);
    });

    it("returns the empty-result message", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [],
        total_count: 0,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      } satisfies PaginatedResult<ITGlueConfiguration>);

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toContain(
        "No configurations found matching the specified filters."
      );
    });

    it("returns markdown format with configuration details", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1",
            type: "configurations",
            name: "Edge Firewall",
            configuration_type_name: "Firewall",
            configuration_status_name: "Active",
            primary_ip: "10.0.0.1",
            serial_number: "SN-001",
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
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      const text = result.content[0].text;
      expect(text).toContain("# Configurations (1 total)");
      expect(text).toContain("## Edge Firewall (ID: 1)");
      expect(text).toContain("**Type**: Firewall");
      expect(text).toContain("**Status**: Active");
      expect(text).toContain("**Primary IP**: 10.0.0.1");
      expect(text).toContain("**Serial**: SN-001");
    });

    it("returns JSON format", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [{ id: "1", name: "Edge Firewall" }],
        total_count: 1,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      });

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(1);
    });

    it("includes pagination info when has_more is true", async () => {
      mockClient.getMany.mockResolvedValue({
        data: [
          {
            id: "1",
            name: "Edge Firewall",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
        total_count: 100,
        page_number: 1,
        page_size: 50,
        has_more: true,
        next_page: 2,
      });

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toContain("page_number: 2");
    });

    it("returns isError on failure", async () => {
      mockClient.getMany.mockRejectedValue(new Error("Network error"));

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error");
    });
  });

  describe("itglue_get_configuration", () => {
    const handler = () => handlers["itglue_get_configuration"];

    it("calls getOne with the correct path", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        type: "configurations",
        name: "Edge Firewall",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      await handler()({ configuration_id: 42, response_format: "markdown" });

      expect(mockClient.getOne).toHaveBeenCalledWith("/configurations/42");
    });

    it("returns markdown with all fields", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        type: "configurations",
        name: "Edge Firewall",
        organization_name: "Acme Corp",
        configuration_type_name: "Firewall",
        configuration_status_name: "Active",
        hostname: "fw-edge-01",
        primary_ip: "10.0.0.1",
        mac_address: "00:11:22:33:44:55",
        serial_number: "SN-001",
        asset_tag: "AT-001",
        manufacturer_name: "Fortinet",
        model_name: "FortiGate 100F",
        resource_url: "https://app.itglue.com/configs/42",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        configuration_id: 42,
        response_format: "markdown",
      });

      const text = result.content[0].text;
      expect(text).toContain("# Edge Firewall");
      expect(text).toContain("**ID**: 42");
      expect(text).toContain("**Organization**: Acme Corp");
      expect(text).toContain("**Type**: Firewall");
      expect(text).toContain("**Status**: Active");
      expect(text).toContain("**Hostname**: fw-edge-01");
      expect(text).toContain("**Primary IP**: 10.0.0.1");
      expect(text).toContain("**MAC Address**: 00:11:22:33:44:55");
      expect(text).toContain("**Serial**: SN-001");
      expect(text).toContain("**Asset Tag**: AT-001");
      expect(text).toContain("**Manufacturer**: Fortinet");
      expect(text).toContain("**Model**: FortiGate 100F");
      expect(text).toContain("**URL**: https://app.itglue.com/configs/42");
    });

    it("renders Notes and Operating System Notes with HTML stripped", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "42",
        type: "configurations",
        name: "Edge Firewall",
        operating_system_notes: "<p>Runs FortiOS 7.2</p>",
        notes: "<p>Primary DC firewall</p>",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        configuration_id: 42,
        response_format: "markdown",
      });

      const text = result.content[0].text;
      expect(text).toContain("## Operating System Notes");
      expect(text).toContain("Runs FortiOS 7.2");
      expect(text).toContain("## Notes");
      expect(text).toContain("Primary DC firewall");
      expect(text).not.toContain("<p>");
    });

    it("returns JSON format", async () => {
      const config = { id: "42", name: "Edge Firewall" };
      mockClient.getOne.mockResolvedValue(config);

      const result = await handler()({
        configuration_id: 42,
        response_format: "json",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("42");
    });

    it("returns isError on failure", async () => {
      mockClient.getOne.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        configuration_id: 999,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
    });
  });
});
