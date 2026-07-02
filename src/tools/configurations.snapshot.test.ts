import { describe, it, expect, beforeEach } from "vitest";
import { registerConfigurationTools } from "./configurations.js";
import { makeMockClient, makeMockServer } from "../test-helpers.js";
import type { ITGlueConfiguration, PaginatedResult } from "../types.js";

// Golden snapshots: lock the CURRENT verbatim output of every configurations
// tool path so a later factory/formatter change stays byte-identical.
// All mock data is hard-coded (ids, names, timestamps) for determinism.

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe("configurations tools (golden snapshots)", () => {
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

  describe("itglue_list_configurations", () => {
    const handler = () => handlers["itglue_list_configurations"];

    it("markdown: multiple configs with all optional fields, has_more:false", async () => {
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
          {
            id: "2",
            type: "configurations",
            name: "Core Switch",
            configuration_type_name: "Switch",
            configuration_status_name: "Active",
            primary_ip: "10.0.0.2",
            serial_number: "SN-002",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
        ],
        total_count: 2,
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

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Configurations (2 total)

        ## Edge Firewall (ID: 1)
        - **Type**: Firewall
        - **Status**: Active
        - **Primary IP**: 10.0.0.1
        - **Serial**: SN-001
        - **Updated**: 2024-06-01T00:00:00.000Z

        ## Core Switch (ID: 2)
        - **Type**: Switch
        - **Status**: Active
        - **Primary IP**: 10.0.0.2
        - **Serial**: SN-002
        - **Updated**: 2024-06-02T00:00:00.000Z

        ---
        Page 1 | 2 total results"
      `);
    });

    it("markdown: multiple configs with all optional fields, has_more:true", async () => {
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
          {
            id: "2",
            type: "configurations",
            name: "Core Switch",
            configuration_type_name: "Switch",
            configuration_status_name: "Active",
            primary_ip: "10.0.0.2",
            serial_number: "SN-002",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
        ],
        total_count: 100,
        page_number: 1,
        page_size: 50,
        has_more: true,
        next_page: 2,
      } satisfies PaginatedResult<ITGlueConfiguration>);

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Configurations (100 total)

        ## Edge Firewall (ID: 1)
        - **Type**: Firewall
        - **Status**: Active
        - **Primary IP**: 10.0.0.1
        - **Serial**: SN-001
        - **Updated**: 2024-06-01T00:00:00.000Z

        ## Core Switch (ID: 2)
        - **Type**: Switch
        - **Status**: Active
        - **Primary IP**: 10.0.0.2
        - **Serial**: SN-002
        - **Updated**: 2024-06-02T00:00:00.000Z

        ---
        Page 1 | 100 total results
        More results available — use page_number: 2 to see next page"
      `);
    });

    it("json: multiple configs", async () => {
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
          {
            id: "2",
            type: "configurations",
            name: "Core Switch",
            configuration_type_name: "Switch",
            configuration_status_name: "Active",
            primary_ip: "10.0.0.2",
            serial_number: "SN-002",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
        ],
        total_count: 2,
        page_number: 1,
        page_size: 50,
        has_more: false,
        next_page: null,
      } satisfies PaginatedResult<ITGlueConfiguration>);

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "data": [
            {
              "id": "1",
              "type": "configurations",
              "name": "Edge Firewall",
              "configuration_type_name": "Firewall",
              "configuration_status_name": "Active",
              "primary_ip": "10.0.0.1",
              "serial_number": "SN-001",
              "updated_at": "2024-06-01T00:00:00.000Z"
            },
            {
              "id": "2",
              "type": "configurations",
              "name": "Core Switch",
              "configuration_type_name": "Switch",
              "configuration_status_name": "Active",
              "primary_ip": "10.0.0.2",
              "serial_number": "SN-002",
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
      } satisfies PaginatedResult<ITGlueConfiguration>);

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`"No configurations found matching the specified filters."`);
    });

    it("isError when the client rejects", async () => {
      mockClient.getMany.mockRejectedValue(new Error("Network error"));

      const result = await handler()({
        organization_id: 99,
        page_number: 1,
        page_size: 50,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Network error"`);
    });
  });

  describe("itglue_get_configuration", () => {
    const handler = () => handlers["itglue_get_configuration"];

    it("markdown: all optional fields present, with Notes and Operating System Notes", async () => {
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
        operating_system_notes: "<p>Runs FortiOS 7.2</p>",
        notes: "<p>Primary DC firewall</p>",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        configuration_id: 42,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Edge Firewall

        **ID**: 42
        **Organization**: Acme Corp
        **Type**: Firewall
        **Status**: Active
        **Hostname**: fw-edge-01
        **Primary IP**: 10.0.0.1
        **MAC Address**: 00:11:22:33:44:55
        **Serial**: SN-001
        **Asset Tag**: AT-001
        **Manufacturer**: Fortinet
        **Model**: FortiGate 100F
        **URL**: https://app.itglue.com/configs/42

        - **Created**: 2024-01-01T00:00:00.000Z
        - **Updated**: 2024-06-01T00:00:00.000Z

        ## Operating System Notes

        Runs FortiOS 7.2

        ## Notes

        Primary DC firewall"
      `);
    });

    it("markdown: minimal config with optional fields null/absent", async () => {
      mockClient.getOne.mockResolvedValue({
        id: "7",
        type: "configurations",
        name: "Minimal Config",
        organization_name: null,
        configuration_type_name: null,
        configuration_status_name: null,
        hostname: null,
        primary_ip: null,
        mac_address: null,
        serial_number: null,
        asset_tag: null,
        manufacturer_name: null,
        model_name: null,
        resource_url: null,
        operating_system_notes: null,
        notes: null,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        configuration_id: 7,
        response_format: "markdown",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "# Minimal Config

        **ID**: 7

        - **Created**: 2024-01-01T00:00:00.000Z
        - **Updated**: 2024-06-01T00:00:00.000Z"
      `);
    });

    it("json: all optional fields present", async () => {
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
        operating_system_notes: "<p>Runs FortiOS 7.2</p>",
        notes: "<p>Primary DC firewall</p>",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-06-01T00:00:00.000Z",
      });

      const result = await handler()({
        configuration_id: 42,
        response_format: "json",
      });

      expect(result.content[0].text).toMatchInlineSnapshot(`
        "{
          "id": "42",
          "type": "configurations",
          "name": "Edge Firewall",
          "organization_name": "Acme Corp",
          "configuration_type_name": "Firewall",
          "configuration_status_name": "Active",
          "hostname": "fw-edge-01",
          "primary_ip": "10.0.0.1",
          "mac_address": "00:11:22:33:44:55",
          "serial_number": "SN-001",
          "asset_tag": "AT-001",
          "manufacturer_name": "Fortinet",
          "model_name": "FortiGate 100F",
          "resource_url": "https://app.itglue.com/configs/42",
          "operating_system_notes": "<p>Runs FortiOS 7.2</p>",
          "notes": "<p>Primary DC firewall</p>",
          "created_at": "2024-01-01T00:00:00.000Z",
          "updated_at": "2024-06-01T00:00:00.000Z"
        }"
      `);
    });

    it("isError when the client rejects", async () => {
      mockClient.getOne.mockRejectedValue(new Error("Not found"));

      const result = await handler()({
        configuration_id: 999,
        response_format: "markdown",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatchInlineSnapshot(`"Error: Unexpected error: Not found"`);
    });
  });
});
