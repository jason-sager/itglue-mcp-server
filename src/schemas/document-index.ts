import { z } from "zod";
import { PaginationSchema, ResponseFormatSchema } from "./common.js";

export const IndexDocumentsSchema = z
  .object({
    mode: z
      .enum(["full", "incremental"])
      .default("incremental")
      .describe(
        "'full' rebuilds from scratch; 'incremental' re-sweeps titles and only re-fetches content for added/changed documents (much cheaper on repeat runs)."
      ),
    organization_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Scope the build to one organization. REQUIRED when include_content is true. Omit for a titles-only sweep across all organizations."
      ),
    include_content: z
      .boolean()
      .default(false)
      .describe(
        "Also index document body content (keyword terms). Requires organization_id. Costs roughly one API call per document."
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();

export type IndexDocumentsInput = z.infer<typeof IndexDocumentsSchema>;

export const SearchDocumentsSchema = z
  .object({
    query: z
      .string()
      .min(1, "A search query is required")
      .describe("Keywords to match against document titles (and content, if indexed)."),
    organization_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Limit the search to a single organization."),
    search_content: z
      .boolean()
      .default(false)
      .describe(
        "Also match indexed document body content. Requires that the organization's content has been indexed via itglue_index_documents."
      ),
    ...PaginationSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

export type SearchDocumentsInput = z.infer<typeof SearchDocumentsSchema>;

export const IndexStatusSchema = z
  .object({
    organization_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Show status for a single organization instead of all."),
    response_format: ResponseFormatSchema,
  })
  .strict();

export type IndexStatusInput = z.infer<typeof IndexStatusSchema>;
