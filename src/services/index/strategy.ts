import type { ITGlueClient } from "../itglue-client.js";
import type {
  ContentDocEntry,
  ContentPath,
  IndexCapabilities,
  TitleEntry,
} from "./types.js";

/** An organization in scope for an index build. */
export interface OrgRef {
  id: string;
  name: string;
}

export interface StrategyContext {
  /** Max concurrent per-record fetches during a content build. */
  concurrency: number;
}

export interface ContentResult {
  entries: ContentDocEntry[];
  path: ContentPath;
}

/**
 * Per-entity indexing behavior. The EntityIndexer owns the entity-agnostic
 * orchestration (titles diff, incremental refresh, manifest); a strategy
 * supplies only what differs between resource types: how to sweep an org's
 * titles, which optional API capabilities to probe, and how to gather each
 * record's searchable content.
 */
export interface IndexStrategy {
  /** Tool-facing entity type, e.g. "documents" or "configurations". */
  readonly entityType: string;

  /** Sweep one organization's title entries for this entity. */
  sweepOrgTitles(client: ITGlueClient, org: OrgRef): Promise<TitleEntry[]>;

  /**
   * Probe optional API capabilities on a sample org. Omit for entities whose
   * content comes from the list record itself (no capability affects them).
   */
  probeCapabilities?(
    client: ITGlueClient,
    sampleOrgId: string
  ): Promise<IndexCapabilities>;

  /**
   * Fetch and normalize searchable content for a set of titles in one org.
   * `capabilities` is this entity's probed capabilities (or null).
   */
  fetchContent(
    client: ITGlueClient,
    orgId: string,
    titles: TitleEntry[],
    capabilities: IndexCapabilities | null,
    ctx: StrategyContext
  ): Promise<ContentResult>;
}
