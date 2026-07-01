import { IndexStore } from "./store.js";
import {
  normalizeQuery,
  normalizeTextToTerms,
  termOverlap,
} from "./normalize.js";
import type { ContentDocEntry, SearchResponse, SearchResultItem } from "./types.js";

export interface SearchParams {
  query: string;
  organizationId?: string;
  searchContent: boolean;
  pageNumber: number;
  pageSize: number;
}

export type SearchOutcome =
  | { status: "no-index"; message: string }
  | { status: "empty-query"; message: string }
  | { status: "ok"; response: SearchResponse };

const TITLE_WEIGHT = 3;
const CONTENT_WEIGHT = 1;
const PHRASE_BONUS = 2;

/** Keyword search over the cached titles (+ optional content) index. */
export class DocumentSearcher {
  constructor(private readonly store: IndexStore) {}

  async search(params: SearchParams): Promise<SearchOutcome> {
    const titles = await this.store.readTitles();
    if (!titles) {
      return {
        status: "no-index",
        message:
          "No search index found. Run itglue_index_documents to build one, or use itglue_list_documents for a live per-organization lookup.",
      };
    }

    const qTerms = normalizeQuery(params.query);
    if (qTerms.length === 0) {
      return {
        status: "empty-query",
        message:
          "The query contains no searchable terms (only stopwords or punctuation). Try more specific keywords.",
      };
    }
    const rawQuery = params.query.trim().toLowerCase();

    let entries = titles.entries;
    if (params.organizationId) {
      entries = entries.filter((e) => e.org_id === params.organizationId);
    }

    // Cache content shards per org (loaded lazily, only when searching content).
    const shardCache = new Map<string, Map<string, ContentDocEntry> | null>();
    const missingContentOrgs = new Set<string>();
    const loadShard = async (
      orgId: string
    ): Promise<Map<string, ContentDocEntry> | null> => {
      if (shardCache.has(orgId)) return shardCache.get(orgId) ?? null;
      const shard = await this.store.readContentShard(orgId);
      const map = shard
        ? new Map(shard.entries.map((e) => [e.id, e]))
        : null;
      shardCache.set(orgId, map);
      if (!map) missingContentOrgs.add(orgId);
      return map;
    };

    const results: SearchResultItem[] = [];
    for (const t of entries) {
      const titleMatches = termOverlap(qTerms, normalizeTextToTerms(t.name));

      let contentMatches: string[] = [];
      let contentIndexed = false;
      if (params.searchContent) {
        const shard = await loadShard(t.org_id);
        const entry = shard?.get(t.id);
        if (entry) {
          contentIndexed = true;
          contentMatches = termOverlap(qTerms, entry.terms);
        }
      }

      const phraseBonus =
        rawQuery.length > 0 && t.name.toLowerCase().includes(rawQuery)
          ? PHRASE_BONUS
          : 0;
      const score =
        titleMatches.length * TITLE_WEIGHT +
        contentMatches.length * CONTENT_WEIGHT +
        phraseBonus;

      if (score > 0) {
        results.push({
          id: t.id,
          name: t.name,
          org_id: t.org_id,
          org_name: t.org_name,
          updated_at: t.updated_at,
          published: t.published,
          score,
          title_matches: titleMatches,
          content_matches: contentMatches,
          content_indexed: contentIndexed,
        });
      }
    }

    results.sort(
      (a, b) =>
        b.score - a.score ||
        b.updated_at.localeCompare(a.updated_at) ||
        a.name.localeCompare(b.name)
    );

    const total = results.length;
    const start = (params.pageNumber - 1) * params.pageSize;
    const pageItems = results.slice(start, start + params.pageSize);

    return {
      status: "ok",
      response: {
        query: params.query,
        results: pageItems,
        total_count: total,
        page_number: params.pageNumber,
        page_size: params.pageSize,
        has_more: start + params.pageSize < total,
        titles_built_at: titles.builtAt,
        searched_content: params.searchContent,
        content_orgs_missing: [...missingContentOrgs],
      },
    };
  }
}
