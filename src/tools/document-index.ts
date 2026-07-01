import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleApiError, paginationFooter } from "../services/itglue-client.js";
import { ResponseFormat } from "../constants.js";
import type { DocumentIndexer } from "../services/index/indexer.js";
import type { DocumentSearcher } from "../services/index/search.js";
import type { IndexStore } from "../services/index/store.js";
import type { BuildReport, IndexManifest } from "../services/index/types.js";
import {
  IndexDocumentsSchema,
  SearchDocumentsSchema,
  IndexStatusSchema,
  type IndexDocumentsInput,
  type SearchDocumentsInput,
  type IndexStatusInput,
} from "../schemas/document-index.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: handleApiError(error) }],
    isError: true,
  };
}

function formatBuildReport(report: BuildReport): string {
  const scope = report.organizationId
    ? `organization ${report.organizationId}`
    : "all organizations (titles)";
  const lines: string[] = [
    `# Index ${report.mode === "full" ? "Build" : "Update"} Complete`,
    "",
    `- **Mode**: ${report.mode}`,
    `- **Scope**: ${scope}`,
    `- **Organizations processed**: ${report.orgsProcessed}`,
    `- **Titles indexed**: ${report.titlesIndexed}`,
  ];
  if (report.mode === "incremental") {
    lines.push(
      `- **Added / Changed / Deleted**: ${report.titlesAdded} / ${report.titlesChanged} / ${report.titlesDeleted}`
    );
  }
  if (report.includeContent) {
    lines.push(
      `- **Content documents indexed**: ${report.contentDocsIndexed} (path: ${report.contentPath ?? "n/a"})`
    );
  }
  lines.push(
    `- **API calls**: ${report.apiCalls}`,
    `- **Duration**: ${(report.durationMs / 1000).toFixed(1)}s`,
    `- **Cache size**: ${formatBytes(report.cacheBytes)}`,
    `- **Cache path**: ${report.cachePath}`
  );
  if (report.capabilities) {
    const c = report.capabilities;
    lines.push(
      `- **API capabilities**: sideload=${c.sideloadSections}, sparse=${c.sparseFieldsets}, global-sweep=${c.globalDocumentsSweep}`
    );
  }
  if (!report.includeContent && report.organizationId) {
    lines.push(
      "",
      "Tip: pass include_content: true (with this organization_id) to also index document body content."
    );
  }
  return lines.join("\n");
}

function formatManifest(
  manifest: IndexManifest,
  organizationId?: string
): string {
  const lines: string[] = [
    `# ITGlue Search Index Status`,
    "",
    `- **Cache path**: ${manifest.host}`,
    `- **Titles**: ${manifest.totals.titleCount} documents across ${manifest.totals.orgCount} organizations` +
      (manifest.titles.builtAt ? ` (built ${manifest.titles.builtAt})` : ""),
    `- **Content-indexed organizations**: ${manifest.totals.contentOrgCount} (${manifest.totals.contentDocCount} documents)`,
    `- **Total cache size**: ${formatBytes(manifest.totals.bytesOnDisk)}`,
  ];
  if (manifest.capabilities) {
    const c = manifest.capabilities;
    lines.push(
      `- **API capabilities**: sideload=${c.sideloadSections}, sparse=${c.sparseFieldsets}, global-sweep=${c.globalDocumentsSweep}`
    );
  }
  lines.push("");

  const entries = Object.values(manifest.orgs)
    .filter((o) => !organizationId || o.org_id === organizationId)
    .sort((a, b) => b.titlesCount - a.titlesCount);

  if (entries.length === 0) {
    lines.push("*No organizations indexed.*");
    return lines.join("\n");
  }

  lines.push("## Organizations", "");
  for (const o of entries) {
    const content = o.contentIndexed
      ? `content: ${o.contentDocCount} docs, ${formatBytes(o.contentBytesOnDisk)}` +
        (o.lastPathUsed ? ` (${o.lastPathUsed})` : "")
      : "content: not indexed";
    lines.push(
      `- **${o.org_name}** (ID: ${o.org_id}) — ${o.titlesCount} titles; ${content}`
    );
  }
  return lines.join("\n");
}

export function registerIndexTools(
  server: McpServer,
  indexer: DocumentIndexer,
  searcher: DocumentSearcher,
  store: IndexStore
): void {
  server.registerTool(
    "itglue_index_documents",
    {
      title: "Build/Update ITGlue Search Index",
      description: `Build or update the local, compressed document search index used by itglue_search_documents.

The TITLES tier is cheap and covers all organizations. The CONTENT tier indexes document body text (as keyword terms only — the original text is not stored or reconstructable) and is opt-in per organization because it costs roughly one API call per document.

Args:
  - mode ("full"|"incremental", default "incremental"): "full" rebuilds; "incremental" re-sweeps titles and only re-fetches content for added/changed documents.
  - organization_id (number, optional): Scope to one org. REQUIRED when include_content is true. Omit for an all-orgs titles sweep.
  - include_content (boolean, default false): Also index body content (requires organization_id).
  - response_format ("markdown"|"json", default "markdown")

Examples:
  - "Index all document titles" -> { mode: "full" }
  - "Index the contents of org 123" -> { mode: "full", organization_id: 123, include_content: true }
  - "Refresh the index" -> { mode: "incremental" }

Notes:
  - Content builds can be long for large organizations; they are resumable via incremental mode.
  - The cache is stored on the local machine (see ITGLUE_CACHE_DIR / --cache-dir).`,
      inputSchema: IndexDocumentsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: IndexDocumentsInput) => {
      try {
        const report = await indexer.build({
          mode: params.mode,
          organizationId:
            params.organization_id !== undefined
              ? String(params.organization_id)
              : undefined,
          includeContent: params.include_content,
        });

        if (params.response_format === ResponseFormat.JSON) {
          return textResult(JSON.stringify(report, null, 2));
        }
        return textResult(formatBuildReport(report));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "itglue_search_documents",
    {
      title: "Search ITGlue Documents (Indexed)",
      description: `Fast keyword search over the local document index (titles, and body content where indexed). Requires itglue_index_documents to have been run first; never calls the ITGlue API.

Results are ranked by keyword overlap (title matches weighted above content matches). For a live, un-indexed lookup by name, use itglue_list_documents instead.

Args:
  - query (string, required): Keywords to match.
  - organization_id (number, optional): Limit to one organization.
  - search_content (boolean, default false): Also match indexed body content.
  - page_number (number, default 1), page_size (number, default 50, max 1000)
  - response_format ("markdown"|"json", default "markdown")

Examples:
  - "Find the VPN runbook" -> { query: "vpn runbook" }
  - "Search org 123 docs mentioning firewall" -> { query: "firewall", organization_id: 123, search_content: true }`,
      inputSchema: SearchDocumentsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: SearchDocumentsInput) => {
      try {
        const outcome = await searcher.search({
          query: params.query,
          organizationId:
            params.organization_id !== undefined
              ? String(params.organization_id)
              : undefined,
          searchContent: params.search_content,
          pageNumber: params.page_number,
          pageSize: params.page_size,
        });

        if (outcome.status !== "ok") {
          return textResult(outcome.message);
        }
        const res = outcome.response;

        if (params.response_format === ResponseFormat.JSON) {
          return textResult(JSON.stringify(res, null, 2));
        }

        if (res.results.length === 0) {
          return textResult(`No documents matched "${res.query}".`);
        }

        const lines: string[] = [
          `# Search Results for "${res.query}" (${res.total_count} total)`,
          "",
        ];
        for (const r of res.results) {
          lines.push(`## ${r.name} (ID: ${r.id})`);
          lines.push(`- **Organization**: ${r.org_name} (ID: ${r.org_id})`);
          lines.push(`- **Score**: ${r.score}`);
          if (r.title_matches.length > 0)
            lines.push(`- **Title matches**: ${r.title_matches.join(", ")}`);
          if (params.search_content) {
            lines.push(
              `- **Content matches**: ${
                r.content_indexed
                  ? r.content_matches.join(", ") || "(none)"
                  : "content not indexed"
              }`
            );
          }
          lines.push(`- **Updated**: ${r.updated_at}`, "");
        }
        lines.push(paginationFooter(res.total_count, res.page_number, res.has_more));
        if (res.titles_built_at) {
          lines.push(`Index built: ${res.titles_built_at}`);
        }
        if (params.search_content && res.content_orgs_missing.length > 0) {
          lines.push(
            `Note: ${res.content_orgs_missing.length} organization(s) in scope have no content index — run itglue_index_documents with include_content for them.`
          );
        }
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "itglue_index_status",
    {
      title: "ITGlue Search Index Status",
      description: `Report what is currently in the local document search index: organizations covered, title counts, which organizations have content indexed, cache sizes, and when each was last updated. Use this to decide whether to (re)build the index.

Args:
  - organization_id (number, optional): Show status for a single organization.
  - response_format ("markdown"|"json", default "markdown")`,
      inputSchema: IndexStatusSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: IndexStatusInput) => {
      try {
        const manifest = await store.readManifest();
        if (!manifest) {
          return textResult(
            "No search index has been built yet. Run itglue_index_documents to create one."
          );
        }

        if (params.response_format === ResponseFormat.JSON) {
          return textResult(JSON.stringify(manifest, null, 2));
        }
        return textResult(
          formatManifest(
            manifest,
            params.organization_id !== undefined
              ? String(params.organization_id)
              : undefined
          )
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
