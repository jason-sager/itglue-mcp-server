// On-disk schema for the fork-only search index (v2, entity-aware).
//
// The index covers multiple ITGlue entity types (documents, configurations,
// …). Each entry is tagged with its entity_type; titles and content shards are
// stored per entity. The content tier stores only a sorted, deduplicated set of
// keyword terms per record — never the original prose. Word order and
// repetition are discarded, so the source cannot be reconstructed from the
// cache (a deliberate privacy property), and the representation compresses well.

/**
 * Optional API capabilities detected at build time. These are document-specific
 * (sections sideload / sparse fieldsets / global sweep); entity types that
 * gather content from the list record itself (e.g. configurations) do not use
 * them and store null.
 */
export interface IndexCapabilities {
  /** GET documents with `include=sections` populates `included`. */
  sideloadSections: boolean;
  /** A global `GET /documents` (no org scope) works. */
  globalDocumentsSweep: boolean;
  /** JSON:API sparse fieldsets (`fields[documents]=...`) are honored. */
  sparseFieldsets: boolean;
  /** ISO timestamp of when capabilities were probed. */
  probedAt: string;
}

/** One record's metadata in the (cheap, cross-org) titles tier. */
export interface TitleEntry {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  updated_at: string;
  entity_type: string;
  /** Documents only; other entity types omit this. */
  published?: boolean;
}

/** The titles tier for a single entity type. */
export interface TitlesIndex {
  schemaVersion: number;
  entity_type: string;
  builtAt: string;
  host: string;
  entries: TitleEntry[];
}

/** One record's searchable content in the (opt-in, per-org) content tier. */
export interface ContentDocEntry {
  id: string;
  updated_at: string;
  /** Sorted, deduplicated, stopword-stripped keyword terms. */
  terms: string[];
}

/** Which content-fetch path an org's content build used. */
export type ContentPath = "bulk-sideload" | "per-doc" | "list-record";

export interface ContentShard {
  schemaVersion: number;
  entity_type: string;
  org_id: string;
  org_name: string;
  builtAt: string;
  docCount: number;
  path?: ContentPath;
  entries: ContentDocEntry[];
}

export interface OrgManifestEntry {
  org_id: string;
  org_name: string;
  titlesCount: number;
  contentIndexed: boolean;
  contentDocCount: number;
  contentBytesOnDisk: number;
  lastTitlesAt: string | null;
  lastContentAt: string | null;
  lastPathUsed: ContentPath | null;
}

/** Everything the index knows about one entity type. */
export interface EntityManifest {
  entity_type: string;
  capabilities: IndexCapabilities | null;
  titles: {
    count: number;
    builtAt: string | null;
    bytesOnDisk: number;
  };
  orgs: Record<string, OrgManifestEntry>;
}

export interface IndexManifest {
  schemaVersion: number;
  host: string;
  createdAt: string;
  updatedAt: string;
  entities: Record<string, EntityManifest>;
  totals: {
    entityCount: number;
    orgCount: number;
    titleCount: number;
    contentOrgCount: number;
    contentDocCount: number;
    bytesOnDisk: number;
  };
}

/** Summary returned by a build/update run (scoped to one entity type). */
export interface BuildReport {
  entityType: string;
  mode: "full" | "incremental";
  organizationId: string | null;
  includeContent: boolean;
  orgsProcessed: number;
  titlesIndexed: number;
  titlesAdded: number;
  titlesChanged: number;
  titlesDeleted: number;
  contentDocsIndexed: number;
  contentPath: ContentPath | null;
  apiCalls: number;
  durationMs: number;
  cacheBytes: number;
  cachePath: string;
  schemaRebuilt: boolean;
  capabilities: IndexCapabilities | null;
}

export interface SearchResultItem {
  id: string;
  name: string;
  entity_type: string;
  org_id: string;
  org_name: string;
  updated_at: string;
  score: number;
  title_matches: string[];
  content_matches: string[];
  content_indexed: boolean;
  /** Documents only; other entity types omit this. */
  published?: boolean;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  total_count: number;
  page_number: number;
  page_size: number;
  has_more: boolean;
  titles_built_at: string | null;
  searched_content: boolean;
  searched_entities: string[];
  content_orgs_missing: string[];
}
