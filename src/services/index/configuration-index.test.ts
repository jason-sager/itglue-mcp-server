import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { IndexStore } from "./store.js";
import { buildIndexPaths } from "./paths.js";
import { EntityIndexer } from "./indexer.js";
import { EntitySearcher } from "./search.js";
import { configurationStrategy } from "./strategies/configuration.js";
import { makeMockClient } from "../../test-helpers.js";
import type { TitleEntry } from "./types.js";

const BASE_URL = "https://api.itglue.com";
const ORG = { id: "1", name: "Acme" };

/**
 * Deterministic configuration records. Fixed ids/names/IPs/serials/timestamps so
 * normalized term sets and golden snapshots are stable across runs.
 */
const CONFIGS = [
  {
    id: "100",
    type: "configurations",
    name: "Acme Firewall",
    organization_id: 1,
    organization_name: "Acme",
    configuration_type_id: 1,
    configuration_type_name: "Firewall",
    configuration_status_id: 1,
    configuration_status_name: "Active",
    hostname: "fw-01",
    primary_ip: "10.0.0.1",
    mac_address: "AA:BB:CC:00:11:22",
    serial_number: "SN-FW-9001",
    asset_tag: "ASSET-777",
    manufacturer_name: "Fortinet",
    model_name: "FortiGate 60F",
    operating_system_notes: null,
    notes: "<p>The perimeter firewall guards the datacenter.</p>",
    resource_url: null,
    archived: false,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-06-01T00:00:00.000Z",
  },
  {
    id: "101",
    type: "configurations",
    name: "Acme Switch",
    organization_id: 1,
    organization_name: "Acme",
    configuration_type_id: 2,
    configuration_type_name: "Switch",
    configuration_status_id: 1,
    configuration_status_name: "Active",
    hostname: "sw-core",
    primary_ip: "10.0.0.2",
    mac_address: "AA:BB:CC:33:44:55",
    serial_number: "SN-SW-4002",
    asset_tag: "ASSET-778",
    manufacturer_name: "Cisco",
    model_name: "Catalyst 9300",
    operating_system_notes: null,
    notes: "<p>Core distribution switch for the office network.</p>",
    resource_url: null,
    archived: false,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-06-02T00:00:00.000Z",
  },
];

const CONFIGS_PATH = "/organizations/1/relationships/configurations";

/** getAll returns the configuration list; every other endpoint is empty. */
function wireConfigClient(client: ReturnType<typeof makeMockClient>) {
  client.getOne.mockResolvedValue({ id: ORG.id, name: ORG.name });
  client.getAll.mockImplementation((p: string) => {
    if (p === CONFIGS_PATH) return Promise.resolve(CONFIGS);
    return Promise.resolve([]);
  });
}

describe("configurationStrategy (unit)", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
    wireConfigClient(client);
  });

  it("sweepOrgTitles yields configuration TitleEntry rows without a published field", async () => {
    const titles = await configurationStrategy.sweepOrgTitles(
      client as never,
      ORG
    );

    expect(titles).toHaveLength(CONFIGS.length);
    for (const t of titles) {
      expect(t.entity_type).toBe("configurations");
      expect(t.org_id).toBe("1");
      expect(t.org_name).toBe("Acme");
      // Configurations are not published/unpublished — the field must be absent.
      expect("published" in t).toBe(false);
    }

    const fw = titles.find((t) => t.id === "100");
    expect(fw).toMatchObject({
      id: "100",
      name: "Acme Firewall",
      updated_at: "2024-06-01T00:00:00.000Z",
    });
    const sw = titles.find((t) => t.id === "101");
    expect(sw).toMatchObject({
      id: "101",
      name: "Acme Switch",
      updated_at: "2024-06-02T00:00:00.000Z",
    });
  });

  it("fetchContent returns list-record entries whose terms include identifiers + notes tokens", async () => {
    const titles = await configurationStrategy.sweepOrgTitles(
      client as never,
      ORG
    );

    const result = await configurationStrategy.fetchContent(
      client as never,
      "1",
      titles,
      null,
      { concurrency: 5 }
    );

    expect(result.path).toBe("list-record");
    expect(result.entries).toHaveLength(CONFIGS.length);

    const fw = result.entries.find((e) => e.id === "100");
    expect(fw).toBeDefined();
    // updated_at is carried over from the title entry.
    expect(fw?.updated_at).toBe("2024-06-01T00:00:00.000Z");

    // An IP identifier survives tokenization as a single dotted token.
    expect(fw?.terms).toContain("10.0.0.1");
    // Serial-number identifier survives.
    expect(fw?.terms).toContain("sn-fw-9001");
    // A notes keyword is indexed.
    expect(fw?.terms).toContain("firewall");
    expect(fw?.terms).toContain("perimeter");
    // A stopword from the notes is dropped.
    expect(fw?.terms).not.toContain("the");
    // Terms are sorted and deduplicated.
    expect(fw?.terms).toEqual([...new Set(fw?.terms)].sort());

    const sw = result.entries.find((e) => e.id === "101");
    expect(sw?.terms).toContain("10.0.0.2");
    expect(sw?.terms).toContain("cisco");
    expect(sw?.terms).toContain("catalyst");
  });

  it("fetchContent short-circuits on an empty title list", async () => {
    const result = await configurationStrategy.fetchContent(
      client as never,
      "1",
      [],
      null,
      { concurrency: 5 }
    );
    expect(result).toEqual({ entries: [], path: "list-record" });
    // No list call was needed.
    expect(client.getAll).not.toHaveBeenCalled();
  });
});

describe("EntityIndexer with configurationStrategy (integration)", () => {
  let tmpDir: string;
  let store: IndexStore;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "itglue-config-index-"));
    store = new IndexStore(buildIndexPaths(tmpDir, BASE_URL));
    client = makeMockClient();
    wireConfigClient(client);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function indexer() {
    return new EntityIndexer(client as never, store, {
      baseUrl: BASE_URL,
      strategies: [configurationStrategy],
    });
  }

  it("full build indexes configuration titles + content via the list-record path", async () => {
    const report = await indexer().build({
      entityType: "configurations",
      mode: "full",
      organizationId: "1",
      includeContent: true,
    });

    expect(report.entityType).toBe("configurations");
    expect(report.contentPath).toBe("list-record");
    expect(report.titlesIndexed).toBe(CONFIGS.length);
    expect(report.contentDocsIndexed).toBe(CONFIGS.length);
    // configurationStrategy has no probeCapabilities → capabilities stay null.
    expect(report.capabilities).toBeNull();

    const titles = await store.readTitles("configurations");
    expect(titles?.entries.map((e) => e.id).sort()).toEqual(["100", "101"]);
    // No published field leaked onto configuration titles.
    for (const e of titles?.entries ?? []) {
      expect("published" in e).toBe(false);
    }

    const shard = await store.readContentShard("configurations", "1");
    expect(shard).not.toBeNull();
    expect(shard?.path).toBe("list-record");
    expect(shard?.entries.map((e) => e.id).sort()).toEqual(["100", "101"]);
    const fw = shard?.entries.find((e) => e.id === "100");
    expect(fw?.terms).toContain("10.0.0.1");
    expect(fw?.terms).toContain("firewall");

    // A different entity type has nothing indexed.
    expect(await store.readTitles("documents")).toBeNull();
  });
});

describe("EntitySearcher over configuration index", () => {
  let tmpDir: string;
  let store: IndexStore;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "itglue-config-search-"));
    store = new IndexStore(buildIndexPaths(tmpDir, BASE_URL));
    client = makeMockClient();
    wireConfigClient(client);
    await new EntityIndexer(client as never, store, {
      baseUrl: BASE_URL,
      strategies: [configurationStrategy],
    }).build({
      entityType: "configurations",
      mode: "full",
      organizationId: "1",
      includeContent: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds a configuration by a content keyword", async () => {
    const outcome = await new EntitySearcher(store).search({
      query: "perimeter",
      searchContent: true,
      pageNumber: 1,
      pageSize: 20,
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.response.results.length).toBeGreaterThan(0);
    const hit = outcome.response.results.find((r) => r.id === "100");
    expect(hit).toBeDefined();
    expect(hit?.entity_type).toBe("configurations");
    expect(hit?.content_matches).toContain("perimeter");
  });

  it("finds a configuration by a name keyword", async () => {
    const outcome = await new EntitySearcher(store).search({
      query: "switch",
      searchContent: true,
      pageNumber: 1,
      pageSize: 20,
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const hit = outcome.response.results.find((r) => r.id === "101");
    expect(hit).toBeDefined();
    expect(hit?.entity_type).toBe("configurations");
    expect(hit?.title_matches).toContain("switch");
  });

  it("an entityTypes:[documents] filter yields no configuration results", async () => {
    const outcome = await new EntitySearcher(store).search({
      query: "perimeter",
      entityTypes: ["documents"],
      searchContent: true,
      pageNumber: 1,
      pageSize: 20,
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(
      outcome.response.results.some((r) => r.entity_type === "configurations")
    ).toBe(false);
    expect(outcome.response.results).toHaveLength(0);
  });
});
