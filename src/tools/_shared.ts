import { handleApiError } from "../services/itglue-client.js";
import { ResponseFormat } from "../constants.js";

/**
 * Shared MCP tool response envelope.
 *
 * Every tool handler produces the same `{ content: [{ type: "text", text }] }`
 * shape and the same `try/catch → handleApiError` error path. These helpers
 * centralize that boilerplate so per-resource handlers (and the resource
 * factory) only supply what actually varies: the text and the format branch.
 *
 * Behavior is identical to the previously-inlined logic — the golden
 * characterization snapshots in src/tools/*.snapshot.test.ts hold the line.
 */

export interface ToolTextContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  // The MCP SDK's CallToolResult carries an index signature; mirror it so a
  // named ToolResult stays assignable where inline object literals were.
  [key: string]: unknown;
  content: ToolTextContent[];
  isError?: boolean;
}

/** Wrap plain text as a successful tool result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * A non-error informational message (e.g. an empty-result notice). Identical in
 * shape to {@link textResult}; named separately to document intent at call
 * sites and to keep the empty path distinct from the success path.
 */
export function emptyResult(message: string): ToolResult {
  return textResult(message);
}

/** Standard error envelope: map the error to a message and flag isError. */
export function errorResult(error: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: handleApiError(error) }],
    isError: true,
  };
}

/**
 * Branch between JSON and markdown output. Both sides are lazy so only the
 * requested representation is built — matching the original per-tool code,
 * which never constructed the unused format. Any truncation is applied by the
 * caller inside the relevant thunk (truncation rules vary per tool).
 */
export function jsonOrMarkdown(
  format: ResponseFormat,
  json: () => string,
  markdown: () => string
): ToolResult {
  return textResult(format === ResponseFormat.JSON ? json() : markdown());
}
