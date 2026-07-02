import type { ITGlueClient } from "../../itglue-client.js";
import type { ITGlueConfiguration } from "../../../types.js";
import type { ContentDocEntry, TitleEntry } from "../types.js";
import type {
  ContentResult,
  IndexStrategy,
  OrgRef,
} from "../strategy.js";
import { normalizeToTerms } from "../normalize.js";

export const CONFIGURATION_ENTITY_TYPE = "configurations";

function configsPath(orgId: string): string {
  return `/organizations/${orgId}/relationships/configurations`;
}

const TITLE_FIELDS = "name,organization-id,organization-name,updated-at";
const CONTENT_FIELDS =
  "name,notes,hostname,primary-ip,mac-address,serial-number,asset-tag,operating-system-notes,configuration-type-name,configuration-status-name,manufacturer-name,model-name,updated-at";

/** Concatenate a configuration's searchable text (identifiers + notes). */
function configContentText(c: ITGlueConfiguration): string {
  return [
    c.name,
    c.hostname,
    c.primary_ip,
    c.mac_address,
    c.serial_number,
    c.asset_tag,
    c.configuration_type_name,
    c.configuration_status_name,
    c.manufacturer_name,
    c.model_name,
    c.operating_system_notes,
    c.notes,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Configurations: a single org-scoped listing (no folders). Content is gathered
 * from the configuration record itself (identifiers + notes), so it needs no
 * per-record fetch — one list sweep yields both titles and content, which makes
 * configuration content indexing markedly cheaper than documents.
 */
export const configurationStrategy: IndexStrategy = {
  entityType: CONFIGURATION_ENTITY_TYPE,

  async sweepOrgTitles(
    client: ITGlueClient,
    org: OrgRef
  ): Promise<TitleEntry[]> {
    const configs = await client.getAll<ITGlueConfiguration>(
      configsPath(org.id),
      { "fields[configurations]": TITLE_FIELDS }
    );
    return configs.map((c) => ({
      id: c.id,
      name: c.name ?? "",
      org_id: org.id,
      org_name: org.name,
      updated_at: c.updated_at ?? "",
      entity_type: CONFIGURATION_ENTITY_TYPE,
    }));
  },

  // No probeCapabilities: configuration content comes from the list record,
  // so sections sideload / sparse-fieldset probes do not apply.

  async fetchContent(
    client: ITGlueClient,
    orgId: string,
    titles: TitleEntry[]
  ): Promise<ContentResult> {
    if (titles.length === 0) return { entries: [], path: "list-record" };

    const wanted = new Set(titles.map((t) => t.id));
    const updatedById = new Map(titles.map((t) => [t.id, t.updated_at]));
    const configs = await client.getAll<ITGlueConfiguration>(
      configsPath(orgId),
      { "fields[configurations]": CONTENT_FIELDS }
    );

    const entries: ContentDocEntry[] = [];
    for (const c of configs) {
      if (!wanted.has(c.id)) continue;
      entries.push({
        id: c.id,
        updated_at: updatedById.get(c.id) ?? c.updated_at ?? "",
        terms: normalizeToTerms(configContentText(c)),
      });
    }
    return { entries, path: "list-record" };
  },
};
