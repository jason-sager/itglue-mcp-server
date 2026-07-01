import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { IndexStore } from "./store.js";
import { buildIndexPaths } from "./paths.js";
import { DocumentSearcher } from "./search.js";
import { INDEX_SCHEMA_VERSION } from "../../constants.js";
import type { ContentDocEntry, TitleEntry } from "./types.js";

let tmpDir: string;
let store: IndexStore;
let searcher: DocumentSearcher;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "itglue-search-"));
  store = new IndexStore(buildIndexPaths(tmpDir, "https://api.itglue.com"));
  searcher = new DocumentSearcher(store);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function title(over: Partial<TitleEntry> & { id: string; name: string }): TitleEntry {
  return {
    org_id: "1",
    org_name: "Acme",
    updated_at: "2024-01-01",
    published: true,
    ...over,
  };
}

async function seedTitles(entries: TitleEntry[]): Promise<void> {
  await store.writeTitles({
    schemaVersion: INDEX_SCHEMA_VERSION,
    builtAt: "2026-01-01T00:00:00.000Z",
    host: "api.itglue.com",
    entries,
  });
}

async function seedContent(
  orgId: string,
  entries: ContentDocEntry[]
): Promise<void> {
  await store.writeContentShard({
    schemaVersion: INDEX_SCHEMA_VERSION,
    org_id: orgId,
    org_name: "Acme",
    builtAt: "2026-01-01T00:00:00.000Z",
    docCount: entries.length,
    path: "per-doc",
    entries,
  });
}

const base = { searchContent: false, pageNumber: 1, pageSize: 20 };

describe("DocumentSearcher", () => {
  it("reports no-index before anything is built", async () => {
    const out = await searcher.search({ query: "vpn", ...base });
    expect(out.status).toBe("no-index");
  });

  it("reports empty-query for stopword-only queries", async () => {
    await seedTitles([title({ id: "1", name: "VPN Runbook" })]);
    const out = await searcher.search({ query: "the a of", ...base });
    expect(out.status).toBe("empty-query");
  });

  it("matches titles by keyword", async () => {
    await seedTitles([
      title({ id: "1", name: "VPN Runbook" }),
      title({ id: "2", name: "Billing Policy" }),
    ]);
    const out = await searcher.search({ query: "vpn", ...base });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.response.results.map((r) => r.id)).toEqual(["1"]);
    expect(out.response.results[0].title_matches).toContain("vpn");
  });

  it("matches content when search_content is enabled", async () => {
    await seedTitles([title({ id: "1", name: "Runbook" })]);
    await seedContent("1", [
      { id: "1", updated_at: "2024-01-01", terms: ["firewall", "vpn"] },
    ]);
    const out = await searcher.search({
      query: "firewall",
      ...base,
      searchContent: true,
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.response.results).toHaveLength(1);
    expect(out.response.results[0].content_indexed).toBe(true);
    expect(out.response.results[0].content_matches).toContain("firewall");
  });

  it("flags orgs missing content when content search is requested", async () => {
    await seedTitles([title({ id: "1", name: "Firewall Guide", org_id: "7" })]);
    const out = await searcher.search({
      query: "firewall",
      ...base,
      searchContent: true,
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.response.results[0].content_indexed).toBe(false);
    expect(out.response.content_orgs_missing).toContain("7");
  });

  it("filters by organization_id", async () => {
    await seedTitles([
      title({ id: "1", name: "VPN A", org_id: "1" }),
      title({ id: "2", name: "VPN B", org_id: "2" }),
    ]);
    const out = await searcher.search({ query: "vpn", ...base, organizationId: "2" });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.response.results.map((r) => r.id)).toEqual(["2"]);
  });

  it("ranks a title match above a content-only match", async () => {
    await seedTitles([
      title({ id: "1", name: "Firewall Runbook" }),
      title({ id: "2", name: "Onboarding" }),
    ]);
    await seedContent("1", [{ id: "1", updated_at: "2024-01-01", terms: [] }]);
    await seedContent("1", [
      { id: "1", updated_at: "2024-01-01", terms: [] },
      { id: "2", updated_at: "2024-01-01", terms: ["firewall"] },
    ]);
    const out = await searcher.search({
      query: "firewall",
      ...base,
      searchContent: true,
    });
    if (out.status !== "ok") return;
    expect(out.response.results[0].id).toBe("1");
    expect(out.response.results[1].id).toBe("2");
  });

  it("paginates the ranked results", async () => {
    await seedTitles(
      Array.from({ length: 5 }, (_, i) =>
        title({ id: String(i + 1), name: `vpn doc ${i + 1}` })
      )
    );
    const out = await searcher.search({
      query: "vpn",
      searchContent: false,
      pageNumber: 2,
      pageSize: 2,
    });
    if (out.status !== "ok") return;
    expect(out.response.results).toHaveLength(2);
    expect(out.response.total_count).toBe(5);
    expect(out.response.has_more).toBe(true);
  });
});
