import { buildFilterParams } from "../services/itglue-client.js";

/**
 * Query-param helpers for the resource factory.
 *
 * These compose (never replace) the client's buildFilterParams /
 * buildPaginationParams. They add two capabilities the hand-written tools only
 * had inline: advanced filter operators (filter[key][ne], [gt], …) and sparse
 * fieldsets (fields[type]=…), both of which the configuration/flexible-asset
 * resources want as first-class, descriptor-driven features.
 */

function snakeToKebab(key: string): string {
  return key.replace(/_/g, "-");
}

export type FilterOperator = "eq" | "ne" | "gt" | "lt" | "gte" | "lte";

export interface FilterSpec {
  /** Tool input parameter name, e.g. "filter_configuration_type_id". */
  param: string;
  /**
   * JSON:API attribute key (snake_case; kebab-cased on the wire), e.g.
   * "configuration_type_id" → filter[configuration-type-id].
   */
  wireKey: string;
  /** Comparison operator. "eq" (default) emits filter[key]=v; others emit filter[key][op]=v. */
  operator?: FilterOperator;
  /**
   * When true this filter is matched CLIENT-side (case-insensitive substring)
   * and is never sent on the wire — the ITGlue API's name filter is exact-match
   * only, so name search is done locally after fetching the full list.
   */
  clientSubstring?: boolean;
}

/**
 * Build the server-side filter[...] params for the given specs and input
 * values. clientSubstring specs are skipped (matched locally by the factory).
 * eq filters go through buildFilterParams (kebab-casing + filter[] wrapping);
 * operator filters emit filter[kebab-key][op]=value.
 */
export function buildServerFilters(
  specs: FilterSpec[],
  values: Record<string, unknown>
): Record<string, string | number> {
  const eqFilters: Record<string, string | number | undefined> = {};
  const out: Record<string, string | number> = {};

  for (const spec of specs) {
    if (spec.clientSubstring) continue;
    const value = values[spec.param];
    if (value === undefined || value === null) continue;

    const operator = spec.operator ?? "eq";
    if (operator === "eq") {
      eqFilters[spec.wireKey] = value as string | number;
    } else {
      out[`filter[${snakeToKebab(spec.wireKey)}][${operator}]`] =
        value as string | number;
    }
  }

  Object.assign(out, buildFilterParams(eqFilters));
  return out;
}

/**
 * Sparse fieldset param: fields[<type>]=<comma-separated attributes>. Lets a
 * resource request only the columns it renders, trimming payloads on wide
 * resources like configurations.
 */
export function sparseFieldset(
  type: string,
  fields: string
): Record<string, string> {
  return { [`fields[${type}]`]: fields };
}
