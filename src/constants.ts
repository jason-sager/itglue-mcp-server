export const BASE_URLS: Record<string, string> = {
  us: "https://api.itglue.com",
  eu: "https://api.eu.itglue.com",
  au: "https://api.au.itglue.com",
};

export const DEFAULT_BASE_URL = BASE_URLS.us;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 1000;

export const CHARACTER_LIMIT = 25_000;

export const SECTION_TYPES = ["Text", "Heading", "Gallery", "Step"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

// ─── Document Search Index (fork-only content cache) ─────────────
// v2: entity-aware index (documents + configurations + future resources).
// The store returns null on a schema mismatch, so a v1 cache is ignored and
// transparently rebuilt on the next index run.
export const INDEX_SCHEMA_VERSION = 2;
/** Default entity type when a caller does not specify one. */
export const DEFAULT_ENTITY_TYPE = "documents";
export const INDEX_DIR_NAME = "itglue-mcp-server";
/** Max concurrent per-document section fetches during a content build. */
export const INDEX_CONCURRENCY = 5;
/** Tokens shorter/longer than these bounds are dropped during normalization. */
export const INDEX_MIN_TERM_LEN = 2;
export const INDEX_MAX_TERM_LEN = 40;
/** Default number of search results returned. */
export const SEARCH_DEFAULT_LIMIT = 20;
/** gzip compression level for on-disk cache files (0-9). */
export const GZIP_LEVEL = 6;
/** Re-probe API capabilities if the cached probe is older than this. */
export const CAPABILITY_TTL_DAYS = 30;

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}
