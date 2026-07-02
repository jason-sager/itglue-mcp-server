import type { ITGlueClient } from "../../itglue-client.js";
import type {
  ITGlueDocument,
  ITGlueDocumentSection,
} from "../../../types.js";
import type {
  ContentDocEntry,
  IndexCapabilities,
  TitleEntry,
} from "../types.js";
import type {
  ContentResult,
  IndexStrategy,
  OrgRef,
  StrategyContext,
} from "../strategy.js";
import { probeCapabilities } from "../capabilities.js";
import { normalizeToTerms } from "../normalize.js";
import { mapWithConcurrency } from "../../concurrency.js";
import { MAX_PAGE_SIZE } from "../../../constants.js";

export const DOCUMENT_ENTITY_TYPE = "documents";

const TITLE_FIELDS =
  "name,organization-id,organization-name,updated-at,published";

function orgDocsPath(orgId: string): string {
  return `/organizations/${orgId}/relationships/documents`;
}

function sectionsPath(docId: string): string {
  return `/documents/${docId}/relationships/sections`;
}

function joinSectionContent(sections: ITGlueDocumentSection[]): string {
  return [...sections]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((s) => s.content ?? "")
    .join("\n");
}

/**
 * Documents: title sweep merges the root listing with a folder-scoped listing
 * (documents inside folders are excluded from the default listing); content is
 * gathered from each document's sections, bulk via `include=sections` when the
 * API supports it, otherwise one sections fetch per document.
 */
export const documentStrategy: IndexStrategy = {
  entityType: DOCUMENT_ENTITY_TYPE,

  async sweepOrgTitles(
    client: ITGlueClient,
    org: OrgRef
  ): Promise<TitleEntry[]> {
    // Always request sparse fields — harmless if the API ignores them.
    const base: Record<string, string | number> = {
      "fields[documents]": TITLE_FIELDS,
    };
    const path = orgDocsPath(org.id);

    const [root, folder] = await Promise.all([
      client.getAll<ITGlueDocument>(path, base),
      client.getAll<ITGlueDocument>(path, {
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
        entity_type: DOCUMENT_ENTITY_TYPE,
        published: Boolean(doc.published),
      });
    }
    return entries;
  },

  probeCapabilities(
    client: ITGlueClient,
    sampleOrgId: string
  ): Promise<IndexCapabilities> {
    return probeCapabilities(client, sampleOrgId);
  },

  async fetchContent(
    client: ITGlueClient,
    orgId: string,
    titles: TitleEntry[],
    capabilities: IndexCapabilities | null,
    ctx: StrategyContext
  ): Promise<ContentResult> {
    if (titles.length === 0) return { entries: [], path: "per-doc" };

    if (capabilities?.sideloadSections) {
      const bulk = await fetchContentBulk(client, orgId, titles, ctx);
      if (bulk) return { entries: bulk, path: "bulk-sideload" };
      // Fall through to per-doc if the bulk path could not attribute sections.
    }

    const updatedById = new Map(titles.map((t) => [t.id, t.updated_at]));
    const entries = await mapWithConcurrency(
      titles,
      ctx.concurrency,
      async (title) => {
        const terms = await fetchDocTerms(client, title.id);
        return {
          id: title.id,
          updated_at: updatedById.get(title.id) ?? "",
          terms,
        } satisfies ContentDocEntry;
      }
    );
    return { entries, path: "per-doc" };
  },
};

async function fetchDocTerms(
  client: ITGlueClient,
  docId: string
): Promise<string[]> {
  const sections = await client.getMany<ITGlueDocumentSection>(
    sectionsPath(docId),
    { "page[size]": MAX_PAGE_SIZE }
  );
  return normalizeToTerms(joinSectionContent(sections.data));
}

/**
 * Bulk content via `include=sections`. Returns null (triggering per-doc
 * fallback) if the sideload did not actually attribute sections to documents.
 */
async function fetchContentBulk(
  client: ITGlueClient,
  orgId: string,
  titles: TitleEntry[],
  ctx: StrategyContext
): Promise<ContentDocEntry[] | null> {
  const wanted = new Set(titles.map((t) => t.id));
  const updatedById = new Map(titles.map((t) => [t.id, t.updated_at]));
  const sectionsByDoc = new Map<string, ITGlueDocumentSection[]>();
  let sawAnySection = false;

  let pageNumber = 1;
  for (let page = 0; page < 1000; page++) {
    const res = await client.getManyRaw<ITGlueDocument>(orgDocsPath(orgId), {
      "page[number]": pageNumber,
      "page[size]": MAX_PAGE_SIZE,
      include: "sections",
    });
    for (const raw of res.included) {
      const section = raw as ITGlueDocumentSection;
      const docId =
        section.document_id != null ? String(section.document_id) : null;
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
      ctx.concurrency,
      async (title) => ({
        id: title.id,
        updated_at: updatedById.get(title.id) ?? "",
        terms: await fetchDocTerms(client, title.id),
      })
    );
    entries.push(...fallback);
  }

  // Ignore sideloaded sections for docs not in `wanted`.
  return entries.filter((e) => wanted.has(e.id));
}
