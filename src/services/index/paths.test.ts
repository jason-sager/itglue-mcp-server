import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { resolveCacheDir, hostSlug, buildIndexPaths } from "./paths.js";

describe("hostSlug", () => {
  it("slugs a URL host", () => {
    expect(hostSlug("https://api.itglue.com")).toBe("api_itglue_com");
    expect(hostSlug("https://api.eu.itglue.com")).toBe("api_eu_itglue_com");
  });

  it("falls back to 'unknown' for empty input", () => {
    expect(hostSlug("")).toBe("unknown");
  });
});

describe("resolveCacheDir precedence", () => {
  const saved = process.env.ITGLUE_CACHE_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.ITGLUE_CACHE_DIR;
    else process.env.ITGLUE_CACHE_DIR = saved;
  });

  it("prefers an explicit argument over the env var", () => {
    process.env.ITGLUE_CACHE_DIR = path.join(os.tmpdir(), "envcache");
    expect(resolveCacheDir(path.join(os.tmpdir(), "explicit"))).toBe(
      path.resolve(path.join(os.tmpdir(), "explicit"))
    );
  });

  it("uses the env var when no explicit argument", () => {
    const envDir = path.join(os.tmpdir(), "envcache");
    process.env.ITGLUE_CACHE_DIR = envDir;
    expect(resolveCacheDir()).toBe(path.resolve(envDir));
  });

  it("falls back to an OS default that includes the app dir name", () => {
    delete process.env.ITGLUE_CACHE_DIR;
    expect(resolveCacheDir()).toContain("itglue-mcp-server");
  });
});

describe("buildIndexPaths", () => {
  it("namespaces by host and places the artifact files", () => {
    const p = buildIndexPaths(path.join(os.tmpdir(), "cache"), "https://api.itglue.com");
    expect(p.root).toBe(
      path.join(os.tmpdir(), "cache", "api_itglue_com")
    );
    expect(p.titles.endsWith(`${path.sep}titles.json.gz`)).toBe(true);
    expect(p.manifest.endsWith(`${path.sep}manifest.json.gz`)).toBe(true);
    expect(
      p.contentShard("42").endsWith(path.join("content", "org-42.json.gz"))
    ).toBe(true);
  });
});
