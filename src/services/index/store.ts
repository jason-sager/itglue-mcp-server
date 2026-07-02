import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { GZIP_LEVEL, INDEX_SCHEMA_VERSION } from "../../constants.js";
import type { IndexPaths } from "./paths.js";
import type { ContentShard, IndexManifest, TitlesIndex } from "./types.js";

/** Write a value as gzipped JSON atomically (temp file + rename). Returns bytes written. */
export async function writeGzipJson(
  filePath: string,
  value: unknown
): Promise<number> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = gzipSync(Buffer.from(JSON.stringify(value), "utf8"), {
    level: GZIP_LEVEL,
  });
  const tmp = `${filePath}.tmp-${process.pid}-${Math.random()
    .toString(36)
    .slice(2)}`;
  await fs.writeFile(tmp, payload);
  await fs.rename(tmp, filePath);
  return payload.byteLength;
}

/** Read gzipped JSON. Returns null if the file is missing, unreadable, or corrupt. */
export async function readGzipJson<T>(filePath: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(filePath);
    return JSON.parse(gunzipSync(buf).toString("utf8")) as T;
  } catch {
    return null;
  }
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
}

/**
 * Disk persistence for the index. All artifacts are gzipped JSON, written
 * atomically. Reads that hit a schema-version mismatch return null so the
 * caller rebuilds cleanly.
 */
export class IndexStore {
  constructor(private readonly paths: IndexPaths) {}

  get root(): string {
    return this.paths.root;
  }

  async readTitles(entityType: string): Promise<TitlesIndex | null> {
    const titles = await readGzipJson<TitlesIndex>(this.paths.titles(entityType));
    if (!titles || titles.schemaVersion !== INDEX_SCHEMA_VERSION) return null;
    return titles;
  }

  writeTitles(titles: TitlesIndex): Promise<number> {
    return writeGzipJson(this.paths.titles(titles.entity_type), titles);
  }

  titlesSize(entityType: string): Promise<number> {
    return fileSize(this.paths.titles(entityType));
  }

  async readContentShard(
    entityType: string,
    orgId: string
  ): Promise<ContentShard | null> {
    const shard = await readGzipJson<ContentShard>(
      this.paths.contentShard(entityType, orgId)
    );
    if (!shard || shard.schemaVersion !== INDEX_SCHEMA_VERSION) return null;
    return shard;
  }

  writeContentShard(shard: ContentShard): Promise<number> {
    return writeGzipJson(
      this.paths.contentShard(shard.entity_type, shard.org_id),
      shard
    );
  }

  async deleteContentShard(entityType: string, orgId: string): Promise<void> {
    try {
      await fs.rm(this.paths.contentShard(entityType, orgId));
    } catch {
      // Already absent — nothing to do.
    }
  }

  contentShardSize(entityType: string, orgId: string): Promise<number> {
    return fileSize(this.paths.contentShard(entityType, orgId));
  }

  /** Entity types that currently have a titles file on disk. */
  async listTitleEntityTypes(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.paths.root);
      const prefix = "titles-";
      const suffix = ".json.gz";
      return files
        .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
        .map((f) => f.slice(prefix.length, f.length - suffix.length));
    } catch {
      return [];
    }
  }

  /**
   * The (entity_type, org_id) pairs that currently have a content shard on
   * disk. Shard filenames are `<entity>-org-<id>.json.gz`.
   */
  async listContentShards(): Promise<
    Array<{ entity_type: string; org_id: string }>
  > {
    try {
      const files = await fs.readdir(this.paths.contentDir);
      const suffix = ".json.gz";
      const marker = "-org-";
      const out: Array<{ entity_type: string; org_id: string }> = [];
      for (const f of files) {
        if (!f.endsWith(suffix)) continue;
        const base = f.slice(0, f.length - suffix.length);
        const idx = base.indexOf(marker);
        if (idx <= 0) continue;
        out.push({
          entity_type: base.slice(0, idx),
          org_id: base.slice(idx + marker.length),
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  async readManifest(): Promise<IndexManifest | null> {
    const manifest = await readGzipJson<IndexManifest>(this.paths.manifest);
    if (!manifest || manifest.schemaVersion !== INDEX_SCHEMA_VERSION) {
      return null;
    }
    return manifest;
  }

  /**
   * The schemaVersion of the manifest currently on disk, WITHOUT the version
   * gate — used to detect (and report) a schema-driven rebuild. Returns null if
   * there is no manifest yet.
   */
  async priorSchemaVersion(): Promise<number | null> {
    const raw = await readGzipJson<{ schemaVersion?: number }>(
      this.paths.manifest
    );
    return raw?.schemaVersion ?? null;
  }

  /** Manifest is written last, after data files, so it reflects durable state. */
  writeManifest(manifest: IndexManifest): Promise<number> {
    return writeGzipJson(this.paths.manifest, manifest);
  }
}
