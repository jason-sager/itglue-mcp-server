import type { ITGlueClient } from "../itglue-client.js";
import type {
  ITGlueDocument,
  ITGlueDocumentSection,
  ITGlueOrganization,
} from "../../types.js";
import type {
  BuildReport,
  ContentDocEntry,
  ContentPath,
  ContentShard,
  IndexCapabilities,
  IndexManifest,
  OrgManifestEntry,
  TitleEntry,
} from "./types.js";
import { IndexStore } from "./store.js";
import { probeCapabilities } from "./capabilities.js";
import { normalizeToTerms } from "./normalize.js";
import { mapWithConcurrency } from "../concurrency.js";
import {
  INDEX_CONCURRENCY,
  INDEX_SCHEMA_VERSION,
  MAX_PAGE_SIZE,
} from "../../constants.js";

interface OrgRef {
  id: string;
  name: string;
}

export interface BuildParams {
  mode: "full" | "incremental";
  organizationId?: string;
  includeContent: boolean;
}

export interface IndexerOptions {
  baseUrl: string;
  concurrency?: number;
}

const TITLE_FIELDS = "name,organization-id,organization-name,updated-at,published";

function orgDocsPath(orgId: string): string {
  return `/organizations/${orgId}/relationships/documents`;
}

function sectionsPath(docId: string): string {
  return `/documents/${docId}/relationships/sections`;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

/**
 * Builds and maintains the on-disk document search index. The titles tier is
 * cheap and swept across all orgs; the content tier is opt-in and per-org.
 */
export class DocumentIndexer {
  private readonly concurrency: number;

  constructor(
    private readonly client: ITGlueClient,
    private readonly store: IndexStore,
    private readonly options: IndexerOptions
  ) {
    this.concurrency = options.concurrency ?? INDEX_CONCURRENCY;
  }

  async build(params: BuildParams): Promise<BuildReport> {
    if (params.includeContent && !params.organizationId) {
      throw new Error(
        "Content indexing requires an organization_id (index one organization at a time)."
      );
    }

    const startedAt = Date.now();
    const callsBefore = this.client.requestCount;

    const orgs = params.organizationId
      ? [await this.resolveOrg(params.organizationId)]
      : await this.listAllOrgs();

    const prevManifest = await this.store.readManifest();
    let capabilities: IndexCapabilities | null =
      prevManifest?.capabilities ?? null;
    if ((params.mode === "full" || !capabilities) && orgs.length > 0) {
      capabilities = await probeCapabilities(this.client, orgs[0].id);
    }

    // ── Titles ──────────────────────────────────────────────────
    const prevTitles = await this.store.readTitles();
    const prevEntries = prevTitles?.entries ?? [];
    const scopeOrgIds = new Set(orgs.map((o) => o.id));

    const freshByOrg = new Map<string, TitleEntry[]>();
    for (const org of orgs) {
      freshByOrg.set(org.id, await this.sweepOrgTitles(org));
    }

    const diff = diffTitles(prevEntries, freshByOrg, scopeOrgIds);

    // Keep titles for orgs outside this run's scope; replace scope orgs.
    const merged = prevEntries.filter((e) => !scopeOrgIds.has(e.org_id));
    let titlesIndexed = 0;
    for (const list of freshByOrg.values()) {
      merged.push(...list);
      titlesIndexed += list.length;
    }

    const now = new Date().toISOString();
    await this.store.writeTitles({
      schemaVersion: INDEX_SCHEMA_VERSION,
      builtAt: now,
      host: hostOf(this.options.baseUrl),
      entries: merged,
    });

    // ── Content ─────────────────────────────────────────────────
    let contentDocsIndexed = 0;
    let contentPath: ContentPath | null = null;

    if (params.includeContent) {
      const org = orgs[0];
      const fresh = freshByOrg.get(org.id) ?? [];
      const result = await this.buildOrgContent(org, fresh, {
        mode: params.mode,
        capabilities,
        added: diff.addedByOrg.get(org.id) ?? new Set(),
        changed: diff.changedByOrg.get(org.id) ?? new Set(),
        deleted: diff.deletedByOrg.get(org.id) ?? new Set(),
        now,
      });
      contentDocsIndexed = result.docsIndexed;
      contentPath = result.path;
    } else if (params.mode === "incremental") {
      // Even without content, keep content shards free of deleted docs.
      for (const org of orgs) {
        const deleted = diff.deletedByOrg.get(org.id);
        if (deleted && deleted.size > 0) {
          await this.pruneContentShard(org.id, deleted, now);
        }
      }
    }

    const manifest = await this.rebuildManifest(now, capabilities);

    return {
      mode: params.mode,
      organizationId: params.organizationId ?? null,
      includeContent: params.includeContent,
      orgsProcessed: orgs.length,
      titlesIndexed,
      titlesAdded: diff.totalAdded,
      titlesChanged: diff.totalChanged,
      titlesDeleted: diff.totalDeleted,
      contentDocsIndexed,
      contentPath,
      apiCalls: this.client.requestCount - callsBefore,
      durationMs: Date.now() - startedAt,
      cacheBytes: manifest.totals.bytesOnDisk,
      cachePath: this.store.root,
      capabilities,
    };
  }

  // ── Org discovery ─────────────────────────────────────────────

  private async resolveOrg(orgId: string): Promise<OrgRef> {
    const org = await this.client.getOne<ITGlueOrganization>(
      `/organizations/${orgId}`
    );
    return { id: String(org.id), name: org.name ?? String(org.id) };
  }

  private async listAllOrgs(): Promise<OrgRef[]> {
    const orgs = await this.client.getAll<ITGlueOrganization>("/organizations");
    return orgs.map((o) => ({ id: String(o.id), name: o.name ?? String(o.id) }));
  }

  // ── Titles sweep ──────────────────────────────────────────────

  private async sweepOrgTitles(org: OrgRef): Promise<TitleEntry[]> {
    // Always request sparse fields — harmless if the API ignores them.
    const base: Record<string, string | number> = {
      "fields[documents]": TITLE_FIELDS,
    };
    const path = orgDocsPath(org.id);

    const [root, folder] = await Promise.all([
      this.client.getAll<ITGlueDocument>(path, base),
      this.client.getAll<ITGlueDocument>(path, {
        ...base,
        "filter[document-folder-id][ne]": "null",
      }),
    ]);

    const seen = new Set<string>();
    const entries: TitleEntry[] = [];
    for (const doc of [...root, ...folder]) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      entries.push({
        id: doc.id,
        name: doc.name ?? "",
        org_id: org.id,
        org_name: org.name,
        updated_at: doc.updated_at ?? "",
        published: Boolean(doc.published),
      });
    }
    return entries;
  }

  // ── Content build ─────────────────────────────────────────────

  private async buildOrgContent(
    org: OrgRef,
    freshTitles: TitleEntry[],
    ctx: {
      mode: "full" | "incremental";
      capabilities: IndexCapabilities | null;
      added: Set<string>;
      changed: Set<string>;
      deleted: Set<string>;
      now: string;
    }
  ): Promise<{ docsIndexed: number; path: ContentPath }> {
    let entries: ContentDocEntry[];
    let path: ContentPath;

    if (ctx.mode === "full") {
      const fetched = await this.fetchContent(org.id, freshTitles, ctx.capabilities);
      entries = fetched.entries;
      path = fetched.path;
    } else {
      // Incremental: keep unchanged entries, refetch added+changed, drop deleted.
      const prev = await this.store.readContentShard(org.id);
      const prevEntries = prev?.entries ?? [];
      const toRefetchIds = new Set([...ctx.added, ...ctx.changed]);
      const kept = prevEntries.filter(
        (e) => !toRefetchIds.has(e.id) && !ctx.deleted.has(e.id)
      );
      const refetchTitles = freshTitles.filter((t) => toRefetchIds.has(t.id));
      const fetched = await this.fetchContent(
        org.id,
        refetchTitles,
        ctx.capabilities
      );
      entries = [...kept, ...fetched.entries];
      path = fetched.path;
    }

    entries.sort((a, b) => a.id.localeCompare(b.id));
    const shard: ContentShard = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      org_id: org.id,
      org_name: org.name,
      builtAt: ctx.now,
      docCount: entries.length,
      path,
      entries,
    };
    await this.store.writeContentShard(shard);
    return { docsIndexed: entries.length, path };
  }

  /** Fetch + normalize content for a set of documents. Bulk if supported, else per-doc. */
  private async fetchContent(
    orgId: string,
    titles: TitleEntry[],
    capabilities: IndexCapabilities | null
  ): Promise<{ entries: ContentDocEntry[]; path: ContentPath }> {
    if (titles.length === 0) return { entries: [], path: "per-doc" };

    if (capabilities?.sideloadSections) {
      const bulk = await this.fetchContentBulk(orgId, titles);
      if (bulk) return { entries: bulk, path: "bulk-sideload" };
      // Fall through to per-doc if the bulk path could not attribute sections.
    }

    const updatedById = new Map(titles.map((t) => [t.id, t.updated_at]));
    const entries = await mapWithConcurrency(
      titles,
      this.concurrency,
      async (title) => {
        const terms = await this.fetchDocTerms(title.id);
        return {
          id: title.id,
          updated_at: updatedById.get(title.id) ?? "",
          terms,
        } satisfies ContentDocEntry;
      }
    );
    return { entries, path: "per-doc" };
  }

  private async fetchDocTerms(docId: string): Promise<string[]> {
    const sections = await this.client.getMany<ITGlueDocumentSection>(
      sectionsPath(docId),
      { "page[size]": MAX_PAGE_SIZE }
    );
    return normalizeToTerms(joinSectionContent(sections.data));
  }

  /**
   * Bulk content via `include=sections`. Returns null (triggering per-doc
   * fallback) if the sideload did not actually attribute sections to documents.
   */
  private async fetchContentBulk(
    orgId: string,
    titles: TitleEntry[]
  ): Promise<ContentDocEntry[] | null> {
    const wanted = new Set(titles.map((t) => t.id));
    const updatedById = new Map(titles.map((t) => [t.id, t.updated_at]));
    const sectionsByDoc = new Map<string, ITGlueDocumentSection[]>();
    let sawAnySection = false;

    let pageNumber = 1;
    for (let page = 0; page < 1000; page++) {
      const res = await this.client.getManyRaw<ITGlueDocument>(
        orgDocsPath(orgId),
        {
          "page[number]": pageNumber,
          "page[size]": MAX_PAGE_SIZE,
          include: "sections",
        }
      );
      for (const raw of res.included) {
        const section = raw as ITGlueDocumentSection;
        const docId = section.document_id != null ? String(section.document_id) : null;
        if (!docId) continue;
        sawAnySection = true;
        const list = sectionsByDoc.get(docId) ?? [];
        list.push(section);
        sectionsByDoc.set(docId, list);
      }
      if (res.data.length === 0 || !res.has_more || res.next_page === null) break;
      if (res.next_page <= pageNumber) break;
      pageNumber = res.next_page;
    }

    if (!sawAnySection) return null;

    const entries: ContentDocEntry[] = [];
    const missing: TitleEntry[] = [];
    for (const title of titles) {
      const sections = sectionsByDoc.get(title.id);
      if (!sections) {
        missing.push(title);
        continue;
      }
      entries.push({
        id: title.id,
        updated_at: updatedById.get(title.id) ?? "",
        terms: normalizeToTerms(joinSectionContent(sections)),
      });
    }

    // Per-doc fallback for documents whose sections did not sideload.
    if (missing.length > 0) {
      const fallback = await mapWithConcurrency(
        missing,
        this.concurrency,
        async (title) => ({
          id: title.id,
          updated_at: updatedById.get(title.id) ?? "",
          terms: await this.fetchDocTerms(title.id),
        })
      );
      entries.push(...fallback);
    }

    // Ignore sideloaded sections for docs not in `wanted`.
    return entries.filter((e) => wanted.has(e.id));
  }

  private async pruneContentShard(
    orgId: string,
    deleted: Set<string>,
    now: string
  ): Promise<void> {
    const shard = await this.store.readContentShard(orgId);
    if (!shard) return;
    const entries = shard.entries.filter((e) => !deleted.has(e.id));
    if (entries.length === 0) {
      await this.store.deleteContentShard(orgId);
      return;
    }
    await this.store.writeContentShard({
      ...shard,
      builtAt: now,
      docCount: entries.length,
      entries,
    });
  }

  // ── Manifest ──────────────────────────────────────────────────

  private async rebuildManifest(
    now: string,
    capabilities: IndexCapabilities | null
  ): Promise<IndexManifest> {
    const prev = await this.store.readManifest();
    const titles = await this.store.readTitles();
    const titlesEntries = titles?.entries ?? [];
    const titlesBytes = await this.store.titlesSize();

    // Per-org title counts.
    const titleCountByOrg = new Map<string, { count: number; name: string }>();
    for (const e of titlesEntries) {
      const cur = titleCountByOrg.get(e.org_id);
      if (cur) cur.count++;
      else titleCountByOrg.set(e.org_id, { count: 1, name: e.org_name });
    }

    const contentOrgIds = new Set(await this.store.listContentOrgIds());
    const orgs: Record<string, OrgManifestEntry> = {};

    const allOrgIds = new Set<string>([
      ...titleCountByOrg.keys(),
      ...contentOrgIds,
    ]);

    let contentOrgCount = 0;
    let contentDocCount = 0;
    let contentBytes = 0;

    for (const orgId of allOrgIds) {
      const prevEntry = prev?.orgs[orgId];
      const titleInfo = titleCountByOrg.get(orgId);
      let contentIndexed = false;
      let contentDocs = 0;
      let contentSize = 0;
      let lastContentAt: string | null = prevEntry?.lastContentAt ?? null;
      let lastPathUsed = prevEntry?.lastPathUsed ?? null;

      if (contentOrgIds.has(orgId)) {
        const shard = await this.store.readContentShard(orgId);
        if (shard) {
          contentIndexed = true;
          contentDocs = shard.docCount;
          contentSize = await this.store.contentShardSize(orgId);
          lastContentAt = shard.builtAt;
          lastPathUsed = shard.path ?? lastPathUsed;
          contentOrgCount++;
          contentDocCount += contentDocs;
          contentBytes += contentSize;
        }
      }

      orgs[orgId] = {
        org_id: orgId,
        org_name: titleInfo?.name ?? prevEntry?.org_name ?? orgId,
        titlesCount: titleInfo?.count ?? 0,
        contentIndexed,
        contentDocCount: contentDocs,
        contentBytesOnDisk: contentSize,
        lastTitlesAt: titleInfo ? now : prevEntry?.lastTitlesAt ?? null,
        lastContentAt,
        lastPathUsed,
      };
    }

    const manifest: IndexManifest = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      host: hostOf(this.options.baseUrl),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      capabilities,
      titles: {
        count: titlesEntries.length,
        builtAt: titles?.builtAt ?? null,
        bytesOnDisk: titlesBytes,
      },
      orgs,
      totals: {
        orgCount: allOrgIds.size,
        titleCount: titlesEntries.length,
        contentOrgCount,
        contentDocCount,
        bytesOnDisk: titlesBytes + contentBytes,
      },
    };

    await this.store.writeManifest(manifest);
    return manifest;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function joinSectionContent(sections: ITGlueDocumentSection[]): string {
  return [...sections]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((s) => s.content ?? "")
    .join("\n");
}

interface TitlesDiff {
  addedByOrg: Map<string, Set<string>>;
  changedByOrg: Map<string, Set<string>>;
  deletedByOrg: Map<string, Set<string>>;
  totalAdded: number;
  totalChanged: number;
  totalDeleted: number;
}

/** Diff previous vs freshly-swept titles, limited to the swept org scope. */
export function diffTitles(
  prevEntries: TitleEntry[],
  freshByOrg: Map<string, TitleEntry[]>,
  scopeOrgIds: Set<string>
): TitlesDiff {
  const addedByOrg = new Map<string, Set<string>>();
  const changedByOrg = new Map<string, Set<string>>();
  const deletedByOrg = new Map<string, Set<string>>();

  const prevInScope = new Map<string, TitleEntry>();
  for (const e of prevEntries) {
    if (scopeOrgIds.has(e.org_id)) prevInScope.set(e.id, e);
  }

  const seenFresh = new Set<string>();
  for (const [orgId, list] of freshByOrg) {
    for (const doc of list) {
      seenFresh.add(doc.id);
      const prior = prevInScope.get(doc.id);
      if (!prior) {
        addOr(addedByOrg, orgId, doc.id);
      } else if (prior.updated_at !== doc.updated_at) {
        addOr(changedByOrg, orgId, doc.id);
      }
    }
  }

  for (const [id, e] of prevInScope) {
    if (!seenFresh.has(id)) addOr(deletedByOrg, e.org_id, id);
  }

  return {
    addedByOrg,
    changedByOrg,
    deletedByOrg,
    totalAdded: sizeOf(addedByOrg),
    totalChanged: sizeOf(changedByOrg),
    totalDeleted: sizeOf(deletedByOrg),
  };
}

function addOr(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function sizeOf(map: Map<string, Set<string>>): number {
  let total = 0;
  for (const set of map.values()) total += set.size;
  return total;
}
