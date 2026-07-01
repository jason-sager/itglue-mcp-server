import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { IndexStore, readGzipJson, writeGzipJson } from "./store.js";
import { buildIndexPaths } from "./paths.js";
import { INDEX_SCHEMA_VERSION } from "../../constants.js";
import type { ContentShard, TitlesIndex } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "itglue-store-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeStore(): IndexStore {
  return new IndexStore(buildIndexPaths(tmpDir, "https://api.itglue.com"));
}

describe("gzip JSON round-trip", () => {
  it("writes and reads back deep-equal", async () => {
    const file = path.join(tmpDir, "x.json.gz");
    const value = { a: 1, list: ["x", "y"], nested: { z: true } };
    const bytes = await writeGzipJson(file, value);
    expect(bytes).toBeGreaterThan(0);
    expect(await readGzipJson(file)).toEqual(value);
  });

  it("returns null for a missing file", async () => {
    expect(await readGzipJson(path.join(tmpDir, "nope.json.gz"))).toBeNull();
  });

  it("returns null for a corrupt (non-gzip) file", async () => {
    const file = path.join(tmpDir, "bad.json.gz");
    await fs.writeFile(file, Buffer.from("not actually gzip"));
    expect(await readGzipJson(file)).toBeNull();
  });

  it("leaves no temp files behind", async () => {
    await writeGzipJson(path.join(tmpDir, "y.json.gz"), { ok: true });
    const entries = await fs.readdir(tmpDir);
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
  });
});

describe("IndexStore schema-version gate", () => {
  it("round-trips a titles index", async () => {
    const store = makeStore();
    const titles: TitlesIndex = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      builtAt: "2026-01-01T00:00:00.000Z",
      host: "api.itglue.com",
      entries: [],
    };
    await store.writeTitles(titles);
    expect(await store.readTitles()).toEqual(titles);
    expect(await store.titlesSize()).toBeGreaterThan(0);
  });

  it("treats a mismatched schemaVersion as missing", async () => {
    const store = makeStore();
    await writeGzipJson(
      buildIndexPaths(tmpDir, "https://api.itglue.com").titles,
      { schemaVersion: 999, builtAt: "t", host: "h", entries: [] }
    );
    expect(await store.readTitles()).toBeNull();
  });

  it("round-trips and deletes a content shard", async () => {
    const store = makeStore();
    const shard: ContentShard = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      org_id: "42",
      org_name: "Acme",
      builtAt: "2026-01-01T00:00:00.000Z",
      docCount: 1,
      entries: [{ id: "1", updated_at: "t", terms: ["vpn"] }],
    };
    await store.writeContentShard(shard);
    expect(await store.readContentShard("42")).toEqual(shard);
    await store.deleteContentShard("42");
    expect(await store.readContentShard("42")).toBeNull();
  });
});
