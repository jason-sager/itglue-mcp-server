import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodTypeAny } from "zod";
import type { ITGlueClient } from "../services/itglue-client.js";
import {
  buildPaginationParams,
  paginationFooter,
  truncateIfNeeded,
} from "../services/itglue-client.js";
import type { PaginatedResult } from "../types.js";
import { ResponseFormat } from "../constants.js";
import {
  emptyResult,
  errorResult,
  jsonOrMarkdown,
  type ToolResult,
} from "./_shared.js";
import { buildServerFilters, type FilterSpec } from "./params.js";

/**
 * Declarative resource factory.
 *
 * A ResourceDescriptor supplies only what varies per ITGlue resource — paths,
 * filters, and hand-written formatters — and the factory emits the list/get
 * tool handlers, reproducing the shared try/catch → handleApiError envelope,
 * the JSON-vs-markdown branch, pagination footers, empty-result messages, and
 * truncation that were previously copy-pasted per tool. Formatters stay
 * hand-written closures (not derived from field metadata) so quirky output
 * stays explicit and trivially diffable against the golden snapshots.
 */

interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** One endpoint (plus any extra query params) to fetch and merge for a list. */
export interface ListVariant {
  path: string;
  extra?: Record<string, string | number>;
}

interface ListParams {
  page_number: number;
  page_size: number;
  response_format: ResponseFormat;
  sort?: string;
  [key: string]: unknown;
}

interface GetParams {
  response_format: ResponseFormat;
  [key: string]: unknown;
}

export interface ListOp<T extends Record<string, unknown>> {
  toolName: string;
  title: string;
  description: string;
  schema: ZodTypeAny;
  annotations: ToolAnnotations;
  /** Markdown header noun: "Organizations" → "# Organizations (N total)". */
  headingNoun: string;
  emptyMessage: string;
  /** Custom truncation hint for the markdown output; omitted → default message. */
  truncateHint?: string;
  /** Server-side filters (clientSubstring specs are matched locally instead). */
  filters?: FilterSpec[];
  /** Whether params.sort is forwarded to the wire. */
  sortable?: boolean;
  /**
   * Endpoints to query and merge. One variant → the client's paginated result
   * is passed through unchanged (preserves server counts). Multiple variants →
   * pages are merged and deduplicated by id (e.g. documents root + folders).
   */
  variants: (params: ListParams) => ListVariant[];
  /** Client-side substring filter: { param, field } (e.g. filter_name over "name"). */
  substring?: { param: string; field: string };
  /** Per-item markdown block. Should end with a trailing newline, as the originals did. */
  formatItem: (item: T) => string;
}

export interface GetOp<T extends Record<string, unknown>> {
  toolName: string;
  title: string;
  description: string;
  schema: ZodTypeAny;
  annotations: ToolAnnotations;
  /** Fetch the resource (getOne, or a composite fetch for related data). */
  fetch: (client: ITGlueClient, params: GetParams) => Promise<T>;
  /** Object to serialize for JSON output (default: the fetched resource). */
  jsonPayload?: (fetched: T) => unknown;
  truncateJson?: boolean;
  formatOne: (fetched: T, params: GetParams) => string;
  truncateMarkdown?: boolean;
  markdownHint?: string;
}

export interface ResourceDescriptor<
  TList extends Record<string, unknown> = Record<string, unknown>,
  TGet extends Record<string, unknown> = Record<string, unknown>,
> {
  list?: ListOp<TList>;
  get?: GetOp<TGet>;
}

function dedupeById<T extends Record<string, unknown>>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = String((item as { id?: unknown }).id);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}

function makeListHandler<T extends Record<string, unknown>>(
  client: ITGlueClient,
  op: ListOp<T>
) {
  return async (params: ListParams): Promise<ToolResult> => {
    try {
      const variants = op.variants(params);
      const serverFilters = op.filters
        ? buildServerFilters(op.filters, params)
        : {};
      const sortParams: Record<string, string | number> =
        op.sortable && params.sort ? { sort: params.sort } : {};

      const substringValue = op.substring
        ? params[op.substring.param]
        : undefined;

      let result: PaginatedResult<T>;

      if (op.substring && substringValue) {
        // SEARCH MODE: fetch every page of every variant, merge/dedup, match by
        // case-insensitive substring locally, then paginate the matches.
        const fetched: T[] = [];
        for (const variant of variants) {
          const all = await client.getAll<T>(variant.path, {
            ...serverFilters,
            ...sortParams,
            ...(variant.extra ?? {}),
          });
          fetched.push(...all);
        }
        const merged = dedupeById(fetched);
        const needle = String(substringValue).toLowerCase();
        const field = op.substring.field;
        const matches = merged.filter((item) =>
          String((item as Record<string, unknown>)[field] ?? "")
            .toLowerCase()
            .includes(needle)
        );
        const total = matches.length;
        const start = (params.page_number - 1) * params.page_size;
        const data = matches.slice(start, start + params.page_size);
        const hasMore = start + params.page_size < total;
        result = {
          data,
          total_count: total,
          page_number: params.page_number,
          page_size: params.page_size,
          has_more: hasMore,
          next_page: hasMore ? params.page_number + 1 : null,
        };
      } else if (variants.length === 1) {
        // BROWSE MODE, single endpoint: pass the client's paginated result
        // through unchanged (preserves server total_count / has_more / next_page).
        result = await client.getMany<T>(variants[0].path, {
          ...buildPaginationParams(params.page_number, params.page_size),
          ...serverFilters,
          ...sortParams,
          ...(variants[0].extra ?? {}),
        });
      } else {
        // BROWSE MODE, multiple endpoints: merge and deduplicate pages
        // (e.g. documents' root + folder listings).
        const results: PaginatedResult<T>[] = [];
        for (const variant of variants) {
          results.push(
            await client.getMany<T>(variant.path, {
              ...buildPaginationParams(params.page_number, params.page_size),
              ...serverFilters,
              ...sortParams,
              ...(variant.extra ?? {}),
            })
          );
        }
        const merged = dedupeById(results.flatMap((r) => r.data));
        const hasMore = results.some((r) => r.has_more);
        result = {
          data: merged,
          total_count: merged.length,
          page_number: params.page_number,
          page_size: params.page_size,
          has_more: hasMore,
          next_page: hasMore ? params.page_number + 1 : null,
        };
      }

      if (result.data.length === 0) {
        return emptyResult(op.emptyMessage);
      }

      return jsonOrMarkdown(
        params.response_format,
        () => truncateIfNeeded(JSON.stringify(result, null, 2)),
        () => {
          const lines: string[] = [
            `# ${op.headingNoun} (${result.total_count} total)`,
            "",
          ];
          for (const item of result.data) {
            lines.push(op.formatItem(item));
          }
          lines.push(
            paginationFooter(
              result.total_count,
              result.page_number,
              result.has_more
            )
          );
          const text = lines.join("\n");
          return op.truncateHint
            ? truncateIfNeeded(text, op.truncateHint)
            : truncateIfNeeded(text);
        }
      );
    } catch (error) {
      return errorResult(error);
    }
  };
}

function makeGetHandler<T extends Record<string, unknown>>(
  client: ITGlueClient,
  op: GetOp<T>
) {
  return async (params: GetParams): Promise<ToolResult> => {
    try {
      const fetched = await op.fetch(client, params);
      return jsonOrMarkdown(
        params.response_format,
        () => {
          const payload = op.jsonPayload ? op.jsonPayload(fetched) : fetched;
          const text = JSON.stringify(payload, null, 2);
          return op.truncateJson ? truncateIfNeeded(text) : text;
        },
        () => {
          const md = op.formatOne(fetched, params);
          if (!op.truncateMarkdown) return md;
          return op.markdownHint
            ? truncateIfNeeded(md, op.markdownHint)
            : truncateIfNeeded(md);
        }
      );
    } catch (error) {
      return errorResult(error);
    }
  };
}

/** Register a resource's list and/or get tools from its descriptor. */
export function registerResource<
  TList extends Record<string, unknown>,
  TGet extends Record<string, unknown>,
>(
  server: McpServer,
  client: ITGlueClient,
  descriptor: ResourceDescriptor<TList, TGet>
): void {
  if (descriptor.list) {
    const op = descriptor.list;
    server.registerTool(
      op.toolName,
      {
        title: op.title,
        description: op.description,
        inputSchema: op.schema,
        annotations: op.annotations,
      },
      makeListHandler(client, op)
    );
  }
  if (descriptor.get) {
    const op = descriptor.get;
    server.registerTool(
      op.toolName,
      {
        title: op.title,
        description: op.description,
        inputSchema: op.schema,
        annotations: op.annotations,
      },
      makeGetHandler(client, op)
    );
  }
}
