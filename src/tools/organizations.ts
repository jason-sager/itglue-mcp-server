import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ITGlueClient } from "../services/itglue-client.js";
import type { ITGlueOrganization } from "../types.js";
import {
  registerResource,
  type ResourceDescriptor,
} from "./resource-factory.js";
import {
  ListOrganizationsSchema,
  GetOrganizationSchema,
} from "../schemas/organizations.js";

function formatOrganizationRow(org: ITGlueOrganization): string {
  const lines: string[] = [`## ${org.name} (ID: ${org.id})`];
  if (org.description) lines.push(`${org.description}`);
  if (org.organization_type_name)
    lines.push(`- **Type**: ${org.organization_type_name}`);
  if (org.organization_status_name)
    lines.push(`- **Status**: ${org.organization_status_name}`);
  if (org.short_name) lines.push(`- **Short Name**: ${org.short_name}`);
  lines.push(`- **Updated**: ${org.updated_at}`);
  lines.push("");
  return lines.join("\n");
}

function formatOrganizationDetail(org: ITGlueOrganization): string {
  const lines: string[] = [`# ${org.name}`, "", `**ID**: ${org.id}`];
  if (org.description) lines.push(`**Description**: ${org.description}`);
  if (org.short_name) lines.push(`**Short Name**: ${org.short_name}`);
  if (org.organization_type_name)
    lines.push(`**Type**: ${org.organization_type_name}`);
  if (org.organization_status_name)
    lines.push(`**Status**: ${org.organization_status_name}`);
  if (org.primary) lines.push(`**Primary**: Yes`);
  if (org.alert) lines.push(`\n> **Alert**: ${org.alert}`);
  if (org.quick_notes) lines.push(`\n**Quick Notes**: ${org.quick_notes}`);
  lines.push("");
  lines.push(`- **Created**: ${org.created_at}`);
  lines.push(`- **Updated**: ${org.updated_at}`);
  return lines.join("\n");
}

const organizationsDescriptor: ResourceDescriptor<
  ITGlueOrganization,
  ITGlueOrganization
> = {
  list: {
    toolName: "itglue_list_organizations",
    title: "List ITGlue Organizations",
    description: `Search and list organizations in ITGlue. Use this to find organization IDs needed for document operations.

Supports filtering by name, ID, type, and status. Results are paginated.

Note: filter_name is matched by case-insensitive substring client-side (the ITGlue API's name filter is exact-match only); ID/type/status filters are applied server-side.

Args:
  - filter_name (string, optional): Filter by organization name (case-insensitive substring match; fetches all organizations and filters client-side)
  - filter_id (number, optional): Filter by specific organization ID
  - filter_organization_type_id (number, optional): Filter by organization type
  - filter_organization_status_id (number, optional): Filter by status
  - sort (string, optional): Sort field (e.g. "name", "-updated_at")
  - page_number (number, default 1): Page number
  - page_size (number, default 50, max 1000): Results per page
  - response_format ("markdown"|"json", default "markdown"): Output format

Returns:
  List of organizations with id, name, description, type, status, and timestamps.

Examples:
  - "Find the Acme Corp organization" -> { filter_name: "Acme" }
  - "List all organizations sorted by name" -> { sort: "name" }

Error Handling:
  - Returns "Error: Authentication failed..." if API key is invalid
  - Returns "Error: Rate limit exceeded..." if too many requests`,
    schema: ListOrganizationsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    headingNoun: "Organizations",
    emptyMessage: "No organizations found matching the specified filters.",
    filters: [
      { param: "filter_id", wireKey: "id" },
      { param: "filter_organization_type_id", wireKey: "organization_type_id" },
      {
        param: "filter_organization_status_id",
        wireKey: "organization_status_id",
      },
      { param: "filter_name", wireKey: "name", clientSubstring: true },
    ],
    sortable: true,
    variants: () => [{ path: "/organizations" }],
    substring: { param: "filter_name", field: "name" },
    formatItem: formatOrganizationRow,
  },
  get: {
    toolName: "itglue_get_organization",
    title: "Get ITGlue Organization",
    description: `Get detailed information about a specific ITGlue organization by its ID.

Returns the organization's name, description, type, status, short name, alerts, quick notes, and timestamps.

Args:
  - organization_id (number, required): The organization ID
  - response_format ("markdown"|"json", default "markdown"): Output format

Returns:
  Full organization details including all metadata fields.

Examples:
  - "Get details for organization 12345" -> { organization_id: 12345 }

Error Handling:
  - Returns "Error: Resource not found..." if the organization ID doesn't exist`,
    schema: GetOrganizationSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    fetch: (client, params) =>
      client.getOne<ITGlueOrganization>(
        `/organizations/${params.organization_id}`
      ),
    formatOne: formatOrganizationDetail,
  },
};

export function registerOrganizationTools(
  server: McpServer,
  client: ITGlueClient
): void {
  registerResource(server, client, organizationsDescriptor);
}
