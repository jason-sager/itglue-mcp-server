// On-disk schema for the fork-only document search index.
//
// The content tier stores only a sorted, deduplicated set of keyword terms per
// document — never the original prose. Word order and repetition are discarded,
// so the source document cannot be reconstructed from the cache (a deliberate
// privacy property), and the representation compresses extremely well.

/** Which optional API capabilities were detected at build time. */
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

/** One document's metadata in the (cheap, cross-org) titles tier. */
export interface TitleEntry {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  updated_at: string;
  published: boolean;
}

export interface TitlesIndex {
  schemaVersion: number;
  builtAt: string;
  host: string;
  entries: TitleEntry[];
}

/** One document's searchable content in the (opt-in, per-org) content tier. */
export interface ContentDocEntry {
  id: string;
  updated_at: string;
  /** Sorted, deduplicated, stopword-stripped keyword terms. */
  terms: string[];
}

/** Which content-fetch path an org's content build used. */
export type ContentPath = "bulk-sideload" | "per-doc";

export interface ContentShard {
  schemaVersion: number;
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

export interface IndexManifest {
  schemaVersion: number;
  host: string;
  createdAt: string;
  updatedAt: string;
  capabilities: IndexCapabilities | null;
  titles: {
    count: number;
    builtAt: string | null;
    bytesOnDisk: number;
  };
  orgs: Record<string, OrgManifestEntry>;
  totals: {
    orgCount: number;
    titleCount: number;
    contentOrgCount: number;
    contentDocCount: number;
    bytesOnDisk: number;
  };
}

/** Summary returned by a build/update run. */
export interface BuildReport {
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
  capabilities: IndexCapabilities | null;
}

export interface SearchResultItem {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  updated_at: string;
  published: boolean;
  score: number;
  title_matches: string[];
  content_matches: string[];
  content_indexed: boolean;
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
  content_orgs_missing: string[];
}
