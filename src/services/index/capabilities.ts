import type { ITGlueClient } from "../itglue-client.js";
import type { ITGlueDocument } from "../../types.js";
import type { IndexCapabilities } from "./types.js";

function orgDocsPath(orgId: string): string {
  return `/organizations/${orgId}/relationships/documents`;
}

/**
 * Detect optional API capabilities that make indexing cheaper. Each probe is a
 * single small request and fails safe to `false`, so an unsupported capability
 * simply routes the indexer to its reliable fallback.
 */
export async function probeCapabilities(
  client: ITGlueClient,
  sampleOrgId: string
): Promise<IndexCapabilities> {
  const [sideloadSections, sparseFieldsets, globalDocumentsSweep] =
    await Promise.all([
      probeSideloadSections(client, sampleOrgId),
      probeSparseFieldsets(client, sampleOrgId),
      probeGlobalSweep(client),
    ]);
  return {
    sideloadSections,
    sparseFieldsets,
    globalDocumentsSweep,
    probedAt: new Date().toISOString(),
  };
}

async function probeSideloadSections(
  client: ITGlueClient,
  orgId: string
): Promise<boolean> {
  try {
    const res = await client.getManyRaw<ITGlueDocument>(orgDocsPath(orgId), {
      "page[size]": 5,
      include: "sections",
    });
    return res.included.length > 0;
  } catch {
    return false;
  }
}

async function probeSparseFieldsets(
  client: ITGlueClient,
  orgId: string
): Promise<boolean> {
  try {
    const res = await client.getManyRaw<ITGlueDocument>(orgDocsPath(orgId), {
      "page[size]": 1,
      "fields[documents]": "updated-at",
    });
    const first = res.data[0];
    // If sparse fieldsets are honored, `name` is not returned.
    return first !== undefined && !("name" in first);
  } catch {
    return false;
  }
}

async function probeGlobalSweep(client: ITGlueClient): Promise<boolean> {
  try {
    await client.getMany<ITGlueDocument>("/documents", { "page[size]": 1 });
    return true;
  } catch {
    return false;
  }
}
