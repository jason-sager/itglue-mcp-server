import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ITGlueClient } from "../services/itglue-client.js";
import { stripHtml } from "../services/itglue-client.js";
import type { ITGlueConfiguration } from "../types.js";
import {
  registerResource,
  type ResourceDescriptor,
} from "./resource-factory.js";
import {
  ListConfigurationsSchema,
  GetConfigurationSchema,
} from "../schemas/configurations.js";

function formatConfigurationRow(c: ITGlueConfiguration): string {
  const lines: string[] = [`## ${c.name} (ID: ${c.id})`];
  if (c.configuration_type_name)
    lines.push(`- **Type**: ${c.configuration_type_name}`);
  if (c.configuration_status_name)
    lines.push(`- **Status**: ${c.configuration_status_name}`);
  if (c.primary_ip) lines.push(`- **Primary IP**: ${c.primary_ip}`);
  if (c.serial_number) lines.push(`- **Serial**: ${c.serial_number}`);
  lines.push(`- **Updated**: ${c.updated_at}`);
  lines.push("");
  return lines.join("\n");
}

function formatConfigurationDetail(c: ITGlueConfiguration): string {
  const lines: string[] = [`# ${c.name}`, "", `**ID**: ${c.id}`];
  if (c.organization_name)
    lines.push(`**Organization**: ${c.organization_name}`);
  if (c.configuration_type_name)
    lines.push(`**Type**: ${c.configuration_type_name}`);
  if (c.configuration_status_name)
    lines.push(`**Status**: ${c.configuration_status_name}`);
  if (c.hostname) lines.push(`**Hostname**: ${c.hostname}`);
  if (c.primary_ip) lines.push(`**Primary IP**: ${c.primary_ip}`);
  if (c.mac_address) lines.push(`**MAC Address**: ${c.mac_address}`);
  if (c.serial_number) lines.push(`**Serial**: ${c.serial_number}`);
  if (c.asset_tag) lines.push(`**Asset Tag**: ${c.asset_tag}`);
  if (c.manufacturer_name)
    lines.push(`**Manufacturer**: ${c.manufacturer_name}`);
  if (c.model_name) lines.push(`**Model**: ${c.model_name}`);
  if (c.resource_url) lines.push(`**URL**: ${c.resource_url}`);
  lines.push("");
  lines.push(`- **Created**: ${c.created_at}`);
  lines.push(`- **Updated**: ${c.updated_at}`);
  if (c.operating_system_notes) {
    lines.push("", "## Operating System Notes", "", stripHtml(c.operating_system_notes));
  }
  if (c.notes) {
    lines.push("", "## Notes", "", stripHtml(c.notes));
  }
  return lines.join("\n");
}

export const configurationsDescriptor: ResourceDescriptor<
  ITGlueConfiguration,
  ITGlueConfiguration
> = {
  list: {
    toolName: "itglue_list_configurations",
    title: "List ITGlue Configurations",
    description: `List and search configurations (servers, firewalls, switches, workstations, etc.) within a specific organization.

Returns configuration metadata including name, type, status, primary IP, serial number, and timestamps. Use itglue_list_organizations first if you need the organization ID.

Note: filter_name is matched by case-insensitive substring client-side (the ITGlue API's name filter is exact-match only); type/status filters are applied server-side.

Args:
  - organization_id (number, required): Organization ID to list configurations for
  - filter_name (string, optional): Filter by configuration name (case-insensitive substring match; fetches all and filters client-side)
  - filter_configuration_type_id (number, optional): Filter by configuration type
  - filter_configuration_status_id (number, optional): Filter by configuration status
  - sort (string, optional): Sort field (e.g. "name", "-updated_at")
  - page_number (number, default 1): Page number
  - page_size (number, default 50, max 1000): Results per page
  - response_format ("markdown"|"json", default "markdown"): Output format

Returns:
  Paginated list of configurations with id, name, type, status, primary IP, serial, and timestamps.

Examples:
  - "Find the firewall at org 123" -> { organization_id: 123, filter_name: "firewall" }
  - "List all configurations for org 123" -> { organization_id: 123 }

Error Handling:
  - Returns "Error: Authentication failed..." if API key is invalid
  - Returns "Error: Rate limit exceeded..." if too many requests`,
    schema: ListConfigurationsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    headingNoun: "Configurations",
    emptyMessage: "No configurations found matching the specified filters.",
    filters: [
      {
        param: "filter_configuration_type_id",
        wireKey: "configuration_type_id",
      },
      {
        param: "filter_configuration_status_id",
        wireKey: "configuration_status_id",
      },
      { param: "filter_name", wireKey: "name", clientSubstring: true },
    ],
    sortable: true,
    variants: (params) => [
      {
        path: `/organizations/${params.organization_id}/relationships/configurations`,
      },
    ],
    substring: { param: "filter_name", field: "name" },
    formatItem: formatConfigurationRow,
  },
  get: {
    toolName: "itglue_get_configuration",
    title: "Get ITGlue Configuration",
    description: `Get detailed information about a specific ITGlue configuration by its ID.

Returns the configuration's name, type, status, hostname, primary IP, MAC address, serial number, asset tag, manufacturer, model, notes, and timestamps.

Args:
  - configuration_id (number, required): The configuration ID
  - response_format ("markdown"|"json", default "markdown"): Output format

Returns:
  Full configuration details including all metadata fields and notes.

Examples:
  - "Get details for configuration 12345" -> { configuration_id: 12345 }

Error Handling:
  - Returns "Error: Resource not found..." if the configuration ID doesn't exist`,
    schema: GetConfigurationSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    fetch: (client, params) =>
      client.getOne<ITGlueConfiguration>(
        `/configurations/${params.configuration_id}`
      ),
    formatOne: formatConfigurationDetail,
    truncateJson: true,
    truncateMarkdown: true,
  },
};

export function registerConfigurationTools(
  server: McpServer,
  client: ITGlueClient
): void {
  registerResource(server, client, configurationsDescriptor);
}
