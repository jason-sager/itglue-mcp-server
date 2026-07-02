import type { ITGlueClient } from "../itglue-client.js";
import type { ITGlueOrganization } from "../../types.js";
import type {
  BuildReport,
  ContentPath,
  ContentShard,
  EntityManifest,
  IndexCapabilities,
  IndexManifest,
  OrgManifestEntry,
  TitleEntry,
} from "./types.js";
import { IndexStore } from "./store.js";
import type { IndexStrategy, OrgRef } from "./strategy.js";
import {
  DEFAULT_ENTITY_TYPE,
  INDEX_CONCURRENCY,
  INDEX_SCHEMA_VERSION,
} from "../../constants.js";

export interface BuildParams {
  entityType?: string;
  mode: "full" | "incremental";
  organizationId?: string;
  includeContent: boolean;
}

export interface IndexerOptions {
  baseUrl: string;
  strategies: IndexStrategy[];
  concurrency?: number;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

/**
 * Builds and maintains the on-disk search index across entity types. The
 * entity-agnostic orchestration lives here (titles diff, incremental refresh,
 * manifest); per-entity behavior (how to sweep titles, probe capabilities, and
 * gather content) is delegated to an IndexStrategy.
 */
export class EntityIndexer {
  private readonly concurrency: number;
  private readonly strategies: Map<string, IndexStrategy>;

  constructor(
    private readonly client: ITGlueClient,
    private readonly store: IndexStore,
    private readonly options: IndexerOptions
  ) {
    this.concurrency = options.concurrency ?? INDEX_CONCURRENCY;
    this.strategies = new Map(
      options.strategies.map((s) => [s.entityType, s])
    );
  }

  async build(params: BuildParams): Promise<BuildReport> {
    const entityType = params.entityType ?? DEFAULT_ENTITY_TYPE;
    const strategy = this.strategies.get(entityType);
    if (!strategy) {
      throw new Error(
        `Unknown entity type "${entityType}". Known types: ${[
          ...this.strategies.keys(),
        ].join(", ")}.`
      );
    }

    if (params.includeContent && !params.organizationId) {
      throw new Error(
        "Content indexing requires an organization_id (index one organization at a time)."
      );
    }

    const startedAt = Date.now();
    const callsBefore = this.client.requestCount;

    const priorSchema = await this.store.priorSchemaVersion();
    const schemaRebuilt =
      priorSchema !== null && priorSchema !== INDEX_SCHEMA_VERSION;

    const orgs = params.organizationId
      ? [await this.resolveOrg(params.organizationId)]
      : await this.listAllOrgs();

    // Capabilities are per-entity; reuse the prior probe unless this is a full
    // build (or none is cached), and only if the strategy probes at all.
    const prevManifest = await this.store.readManifest();
    let capabilities: IndexCapabilities | null =
      prevManifest?.entities[entityType]?.capabilities ?? null;
    if (
      strategy.probeCapabilities &&
      (params.mode === "full" || !capabilities) &&
      orgs.length > 0
    ) {
      capabilities = await strategy.probeCapabilities(this.client, orgs[0].id);
    }

    // ── Titles ──────────────────────────────────────────────────
    const prevTitles = await this.store.readTitles(entityType);
    const prevEntries = prevTitles?.entries ?? [];
    const scopeOrgIds = new Set(orgs.map((o) => o.id));

    const freshByOrg = new Map<string, TitleEntry[]>();
    for (const org of orgs) {
      freshByOrg.set(org.id, await strategy.sweepOrgTitles(this.client, org));
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
      entity_type: entityType,
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
      const result = await this.buildOrgContent(strategy, org, fresh, {
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
      // Even without content, keep content shards free of deleted records.
      for (const org of orgs) {
        const deleted = diff.deletedByOrg.get(org.id);
        if (deleted && deleted.size > 0) {
          await this.pruneContentShard(entityType, org.id, deleted, now);
        }
      }
    }

    const manifest = await this.rebuildManifest(now, entityType, capabilities);

    return {
      entityType,
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
      schemaRebuilt,
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

  // ── Content build ─────────────────────────────────────────────

  private async buildOrgContent(
    strategy: IndexStrategy,
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
    const entityType = strategy.entityType;
    const strategyCtx = { concurrency: this.concurrency };
    let entries;
    let path: ContentPath;

    if (ctx.mode === "full") {
      const fetched = await strategy.fetchContent(
        this.client,
        org.id,
        freshTitles,
        ctx.capabilities,
        strategyCtx
      );
      entries = fetched.entries;
      path = fetched.path;
    } else {
      // Incremental: keep unchanged entries, refetch added+changed, drop deleted.
      const prev = await this.store.readContentShard(entityType, org.id);
      const prevEntries = prev?.entries ?? [];
      const toRefetchIds = new Set([...ctx.added, ...ctx.changed]);
      const kept = prevEntries.filter(
        (e) => !toRefetchIds.has(e.id) && !ctx.deleted.has(e.id)
      );
      const refetchTitles = freshTitles.filter((t) => toRefetchIds.has(t.id));
      const fetched = await strategy.fetchContent(
        this.client,
        org.id,
        refetchTitles,
        ctx.capabilities,
        strategyCtx
      );
      entries = [...kept, ...fetched.entries];
      path = fetched.path;
    }

    entries.sort((a, b) => a.id.localeCompare(b.id));
    const shard: ContentShard = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      entity_type: entityType,
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

  private async pruneContentShard(
    entityType: string,
    orgId: string,
    deleted: Set<string>,
    now: string
  ): Promise<void> {
    const shard = await this.store.readContentShard(entityType, orgId);
    if (!shard) return;
    const entries = shard.entries.filter((e) => !deleted.has(e.id));
    if (entries.length === 0) {
      await this.store.deleteContentShard(entityType, orgId);
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
    currentEntity: string,
    currentCapabilities: IndexCapabilities | null
  ): Promise<IndexManifest> {
    const prev = await this.store.readManifest();
    const shardsOnDisk = await this.store.listContentShards();

    const entities: Record<string, EntityManifest> = {};
    const orgIdUnion = new Set<string>();
    let titleCount = 0;
    let contentOrgCount = 0;
    let contentDocCount = 0;
    let bytesOnDisk = 0;

    for (const entityType of this.strategies.keys()) {
      const titles = await this.store.readTitles(entityType);
      const titlesEntries = titles?.entries ?? [];
      const contentShardOrgs = new Set(
        shardsOnDisk
          .filter((s) => s.entity_type === entityType)
          .map((s) => s.org_id)
      );

      // Skip entity types with nothing indexed yet, so the manifest reflects
      // only what actually exists on disk.
      if (titlesEntries.length === 0 && contentShardOrgs.size === 0) continue;

      const titlesBytes = await this.store.titlesSize(entityType);
      titleCount += titlesEntries.length;
      bytesOnDisk += titlesBytes;

      const titleCountByOrg = new Map<string, { count: number; name: string }>();
      for (const e of titlesEntries) {
        const cur = titleCountByOrg.get(e.org_id);
        if (cur) cur.count++;
        else titleCountByOrg.set(e.org_id, { count: 1, name: e.org_name });
      }

      const prevEnt = prev?.entities[entityType];
      const allOrgIds = new Set<string>([
        ...titleCountByOrg.keys(),
        ...contentShardOrgs,
      ]);
      const orgs: Record<string, OrgManifestEntry> = {};

      for (const orgId of allOrgIds) {
        orgIdUnion.add(orgId);
        const prevEntry = prevEnt?.orgs[orgId];
        const titleInfo = titleCountByOrg.get(orgId);
        let contentIndexed = false;
        let contentDocs = 0;
        let contentSize = 0;
        let lastContentAt: string | null = prevEntry?.lastContentAt ?? null;
        let lastPathUsed = prevEntry?.lastPathUsed ?? null;

        if (contentShardOrgs.has(orgId)) {
          const shard = await this.store.readContentShard(entityType, orgId);
          if (shard) {
            contentIndexed = true;
            contentDocs = shard.docCount;
            contentSize = await this.store.contentShardSize(entityType, orgId);
            lastContentAt = shard.builtAt;
            lastPathUsed = shard.path ?? lastPathUsed;
            contentOrgCount++;
            contentDocCount += contentDocs;
            bytesOnDisk += contentSize;
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

      entities[entityType] = {
        entity_type: entityType,
        capabilities:
          entityType === currentEntity
            ? currentCapabilities
            : prevEnt?.capabilities ?? null,
        titles: {
          count: titlesEntries.length,
          builtAt: titles?.builtAt ?? null,
          bytesOnDisk: titlesBytes,
        },
        orgs,
      };
    }

    const manifest: IndexManifest = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      host: hostOf(this.options.baseUrl),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      entities,
      totals: {
        entityCount: Object.keys(entities).length,
        orgCount: orgIdUnion.size,
        titleCount,
        contentOrgCount,
        contentDocCount,
        bytesOnDisk,
      },
    };

    await this.store.writeManifest(manifest);
    return manifest;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

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
