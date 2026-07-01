import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { IndexStore } from "./store.js";
import { buildIndexPaths } from "./paths.js";
import { DocumentIndexer, diffTitles } from "./indexer.js";
import { makeMockClient } from "../../test-helpers.js";
import type { TitleEntry } from "./types.js";

const emptyPage = {
  data: [],
  total_count: 0,
  page_number: 1,
  page_size: 1,
  has_more: false,
  next_page: null,
};

const emptyRaw = { ...emptyPage, included: [] };

interface DocRow {
  id: string;
  name: string;
  updated_at: string;
  published?: boolean;
}

/**
 * Wire a mock client for a single-org build: capability probes fail (forcing
 * per-doc content), titles come from getAll, sections from getMany.
 */
function wireClient(
  client: ReturnType<typeof makeMockClient>,
  opts: {
    orgId: string;
    orgName: string;
    docs: DocRow[];
    sectionsByDoc: Record<string, Array<{ id: string; content: string; sort?: number }>>;
  }
) {
  client.getOne.mockResolvedValue({ id: opts.orgId, name: opts.orgName });
  client.getManyRaw.mockResolvedValue(emptyRaw); // sideload + sparse probes + bulk → empty
  client.getMany.mockImplementation((p: string) => {
    const m = /^\/documents\/(.+)\/relationships\/sections$/.exec(p);
    if (m) {
      const sections = opts.sectionsByDoc[m[1]] ?? [];
      return Promise.resolve({ ...emptyPage, data: sections, page_size: 1000 });
    }
    return Promise.resolve(emptyPage); // global-sweep probe on /documents
  });
  client.getAll.mockImplementation(
    (_p: string, params?: Record<string, string | number>) => {
      // Folder call returns nothing; root call returns the docs.
      if (params && params["filter[document-folder-id][ne]"]) {
        return Promise.resolve([]);
      }
      return Promise.resolve(opts.docs);
    }
  );
}

describe("diffTitles", () => {
  const scope = new Set(["1"]);
  const prev: TitleEntry[] = [
    { id: "a", name: "A", org_id: "1", org_name: "O", updated_at: "t1", published: true },
    { id: "b", name: "B", org_id: "1", org_name: "O", updated_at: "t1", published: true },
  ];

  it("detects added, changed, and deleted within scope", () => {
    const fresh = new Map<string, TitleEntry[]>([
      [
        "1",
        [
          { id: "a", name: "A", org_id: "1", org_name: "O", updated_at: "t1", published: true }, // unchanged
          { id: "b", name: "B", org_id: "1", org_name: "O", updated_at: "t2", published: true }, // changed
          { id: "c", name: "C", org_id: "1", org_name: "O", updated_at: "t1", published: true }, // added
        ],
      ],
    ]);
    const diff = diffTitles(prev, fresh, scope);
    expect(diff.totalAdded).toBe(1);
    expect(diff.totalChanged).toBe(1);
    expect(diff.totalDeleted).toBe(0);
    expect(diff.addedByOrg.get("1")?.has("c")).toBe(true);
    expect(diff.changedByOrg.get("1")?.has("b")).toBe(true);
  });

  it("detects deletions", () => {
    const fresh = new Map<string, TitleEntry[]>([["1", [prev[0]]]]);
    const diff = diffTitles(prev, fresh, scope);
    expect(diff.totalDeleted).toBe(1);
    expect(diff.deletedByOrg.get("1")?.has("b")).toBe(true);
  });
});

describe("DocumentIndexer", () => {
  let tmpDir: string;
  let store: IndexStore;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "itglue-indexer-"));
    store = new IndexStore(buildIndexPaths(tmpDir, "https://api.itglue.com"));
    client = makeMockClient();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function indexer() {
    return new DocumentIndexer(client as never, store, {
      baseUrl: "https://api.itglue.com",
    });
  }

  it("full build writes titles and per-doc content", async () => {
    wireClient(client, {
      orgId: "1",
      orgName: "Acme",
      docs: [
        { id: "10", name: "VPN Runbook", updated_at: "t1", published: true },
        { id: "11", name: "Billing", updated_at: "t1", published: true },
      ],
      sectionsByDoc: {
        "10": [{ id: "s1", content: "<p>Configure the VPN firewall</p>", sort: 0 }],
        "11": [{ id: "s2", content: "<p>Invoices and billing</p>", sort: 0 }],
      },
    });

    const report = await indexer().build({
      mode: "full",
      organizationId: "1",
      includeContent: true,
    });

    expect(report.titlesIndexed).toBe(2);
    expect(report.contentDocsIndexed).toBe(2);
    expect(report.contentPath).toBe("per-doc");

    const titles = await store.readTitles();
    expect(titles?.entries.map((e) => e.id).sort()).toEqual(["10", "11"]);

    const shard = await store.readContentShard("1");
    const vpn = shard?.entries.find((e) => e.id === "10");
    expect(vpn?.terms).toContain("firewall");
    expect(vpn?.terms).toContain("vpn");
    expect(vpn?.terms).not.toContain("the"); // stopword dropped
  });

  it("requires an organization_id for content builds", async () => {
    await expect(
      indexer().build({ mode: "full", includeContent: true })
    ).rejects.toThrow(/organization_id/);
  });

  it("incremental only refetches changed documents", async () => {
    wireClient(client, {
      orgId: "1",
      orgName: "Acme",
      docs: [
        { id: "10", name: "VPN", updated_at: "t1", published: true },
        { id: "11", name: "Billing", updated_at: "t1", published: true },
      ],
      sectionsByDoc: {
        "10": [{ id: "s1", content: "<p>vpn firewall</p>", sort: 0 }],
        "11": [{ id: "s2", content: "<p>billing invoices</p>", sort: 0 }],
      },
    });
    await indexer().build({ mode: "full", organizationId: "1", includeContent: true });

    // Doc 10 changes (new updated_at); doc 11 unchanged.
    client.getAll.mockImplementation(
      (_p: string, params?: Record<string, string | number>) => {
        if (params && params["filter[document-folder-id][ne]"]) {
          return Promise.resolve([]);
        }
        return Promise.resolve([
          { id: "10", name: "VPN", updated_at: "t2", published: true },
          { id: "11", name: "Billing", updated_at: "t1", published: true },
        ]);
      }
    );
    client.getMany.mockClear();

    const report = await indexer().build({
      mode: "incremental",
      organizationId: "1",
      includeContent: true,
    });

    expect(report.titlesChanged).toBe(1);
    expect(report.titlesAdded).toBe(0);
    expect(report.contentDocsIndexed).toBe(2); // 1 kept + 1 refetched

    // Only the changed doc's sections were refetched.
    const sectionCalls = client.getMany.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("/relationships/sections")
    );
    expect(sectionCalls).toHaveLength(1);
    expect(sectionCalls[0][0]).toBe("/documents/10/relationships/sections");
  });

  it("titles-only build does not fetch sections", async () => {
    wireClient(client, {
      orgId: "1",
      orgName: "Acme",
      docs: [{ id: "10", name: "VPN", updated_at: "t1", published: true }],
      sectionsByDoc: {},
    });

    const report = await indexer().build({
      mode: "full",
      organizationId: "1",
      includeContent: false,
    });

    expect(report.titlesIndexed).toBe(1);
    expect(report.contentDocsIndexed).toBe(0);
    const sectionCalls = client.getMany.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("/relationships/sections")
    );
    expect(sectionCalls).toHaveLength(0);
    expect(await store.readContentShard("1")).toBeNull();
  });
});
