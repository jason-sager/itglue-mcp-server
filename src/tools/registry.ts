import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ITGlueClient } from "../services/itglue-client.js";
import { registerResource } from "./resource-factory.js";
import { organizationsDescriptor } from "./organizations.js";
import { configurationsDescriptor } from "./configurations.js";

/**
 * Factory-driven resources, registered in one place. Adding a read-only
 * resource is a single line here — no edit to index.ts.
 *
 * Documents, document-sections, and the search-index tools stay as bespoke
 * registrations in index.ts: they are not plain list/get CRUD resources
 * (document sections nest under a document, the index tools drive the local
 * cache, and the document tools carry write operations and a sections
 * sub-fetch), so folding them into the factory would buy little and risk the
 * already-published output.
 */
export function registerResourceTools(
  server: McpServer,
  client: ITGlueClient
): void {
  registerResource(server, client, organizationsDescriptor);
  registerResource(server, client, configurationsDescriptor);
}
