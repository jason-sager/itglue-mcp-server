import os from "node:os";
import path from "node:path";
import { INDEX_DIR_NAME } from "../../constants.js";

/**
 * Resolve the base cache directory. Precedence:
 *   explicit argument > ITGLUE_CACHE_DIR env > per-OS default.
 */
export function resolveCacheDir(explicit?: string): string {
  if (explicit && explicit.trim()) return path.resolve(explicit);
  const env = process.env.ITGLUE_CACHE_DIR;
  if (env && env.trim()) return path.resolve(env);
  return defaultCacheDir();
}

function defaultCacheDir(): string {
  const platform = os.platform();
  if (platform === "win32") {
    const base =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, INDEX_DIR_NAME, "cache");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", INDEX_DIR_NAME);
  }
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.trim() ? xdg : path.join(os.homedir(), ".cache");
  return path.join(base, INDEX_DIR_NAME);
}

/** Filesystem-safe slug for an API base URL host (isolates US/EU/AU/instances). */
export function hostSlug(baseUrl: string): string {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host || baseUrl;
  } catch {
    // Not a URL — fall back to the raw string.
  }
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "unknown";
}

/** Filesystem-safe segment for entity types / org ids used in filenames. */
function safeSegment(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

export interface IndexPaths {
  root: string;
  manifest: string;
  contentDir: string;
  /** Per-entity titles file, e.g. titles-documents.json.gz. */
  titles(entityType: string): string;
  /** Per-entity, per-org content shard, e.g. content/documents-org-42.json.gz. */
  contentShard(entityType: string, orgId: string): string;
}

/** Build the concrete on-disk paths for a resolved cache dir + API host. */
export function buildIndexPaths(
  resolvedCacheDir: string,
  baseUrl: string
): IndexPaths {
  const root = path.join(resolvedCacheDir, hostSlug(baseUrl));
  const contentDir = path.join(root, "content");
  return {
    root,
    manifest: path.join(root, "manifest.json.gz"),
    contentDir,
    titles: (entityType: string) =>
      path.join(root, `titles-${safeSegment(entityType)}.json.gz`),
    contentShard: (entityType: string, orgId: string) =>
      path.join(
        contentDir,
        `${safeSegment(entityType)}-org-${safeSegment(orgId)}.json.gz`
      ),
  };
}
