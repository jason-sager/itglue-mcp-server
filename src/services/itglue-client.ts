import axios, { AxiosError, AxiosInstance } from "axios";
import type {
  ITGlueClientConfig,
  JsonApiRequestBody,
  JsonApiResourceObject,
  JsonApiResponse,
  PaginatedResult,
} from "../types.js";
import { CHARACTER_LIMIT, MAX_PAGE_SIZE } from "../constants.js";

// Hard cap on the number of pages getAll will fetch, protecting against a
// runaway loop if the API's pagination meta ever misbehaves. 50 pages at the
// maximum page size (1000) covers up to 50k records — well beyond any realistic
// per-organization document library.
export const GET_ALL_MAX_PAGES = 50;

// 429-retry tuning (only active when the client is constructed with
// retryOn429: true — see ITGlueClientConfig).
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

// ─── JSON:API Helpers ─────────────────────────────────────────────

function kebabToSnake(key: string): string {
  return key.replace(/-/g, "_");
}

export function deserializeResource<T extends Record<string, unknown>>(
  resource: JsonApiResourceObject
): T {
  const result: Record<string, unknown> = {
    id: resource.id,
    type: resource.type,
  };
  for (const [key, value] of Object.entries(resource.attributes)) {
    result[kebabToSnake(key)] = value;
  }
  return result as T;
}

function snakeToKebab(key: string): string {
  return key.replace(/_/g, "-");
}

export function serializeRequest(
  type: string,
  attributes: Record<string, unknown>,
  id?: string
): JsonApiRequestBody {
  const kebabAttributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      kebabAttributes[snakeToKebab(key)] = value;
    }
  }
  return {
    data: {
      type,
      attributes: kebabAttributes,
      ...(id && { id }),
    },
  };
}

export function serializeDeleteBody(
  type: string,
  ids: number[]
): { data: Array<{ type: string; attributes: { id: number } }> } {
  return {
    data: ids.map((id) => ({
      type,
      attributes: { id },
    })),
  };
}

export function buildFilterParams(
  filters: Record<string, string | number | undefined>
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) {
      params[`filter[${snakeToKebab(key)}]`] = value;
    }
  }
  return params;
}

export function buildPaginationParams(
  pageNumber: number,
  pageSize: number
): Record<string, number> {
  return {
    "page[number]": pageNumber,
    "page[size]": pageSize,
  };
}

function deserializeOne<T extends Record<string, unknown>>(
  data: JsonApiResourceObject | JsonApiResourceObject[],
  operation: string
): T {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error(`API returned empty array for ${operation} operation`);
    }
    return deserializeResource<T>(data[0]);
  }
  return deserializeResource<T>(data);
}

function deserializeOptional<T extends Record<string, unknown>>(
  data: JsonApiResourceObject | JsonApiResourceObject[] | undefined | null
): T | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    return deserializeResource<T>(data[0]);
  }
  return deserializeResource<T>(data);
}

// ─── Error Handling ───────────────────────────────────────────────

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const data = error.response?.data as
      | { errors?: Array<{ title?: string; detail?: string }> }
      | undefined;

    const detail = data?.errors?.[0]?.detail ?? data?.errors?.[0]?.title;
    const suffix = detail ? ` ${detail}` : "";

    if (status) {
      switch (status) {
        case 400:
          return `Error: Bad request.${suffix} Check your parameters.`;
        case 401:
          return "Error: Authentication failed. Verify your ITGLUE_API_KEY is valid and not revoked.";
        case 403:
          return `Error: Permission denied.${suffix} Your API key may not have access to this resource.`;
        case 404:
          return "Error: Resource not found. Verify the ID is correct.";
        case 415:
          return "Error: Unsupported media type. This is likely a bug in the MCP server.";
        case 422:
          return `Error: Validation failed.${suffix}`;
        case 429:
          return "Error: Rate limit exceeded (3000 requests per 5 minutes). Wait before retrying.";
        default:
          if (status >= 500) {
            return `Error: ITGlue server error (${status}). Try again later.`;
          }
          return `Error: API request failed with status ${status}.${suffix}`;
      }
    }

    if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. Please try again.";
    }
    if (error.code === "ECONNREFUSED") {
      return "Error: Could not connect to ITGlue API. Check your base URL and network connectivity.";
    }
  }
  return `Error: Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

// ─── Response Formatting ──────────────────────────────────────────

export function sectionTypeLabel(resourceType: string | null): string {
  if (!resourceType) return "Unknown";
  const parts = resourceType.split("::");
  return parts[parts.length - 1] ?? resourceType;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, (_match, level: string) => "#".repeat(Number(level)) + " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&copy;/g, "\u00A9")
    .replace(/&trade;/g, "\u2122")
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncateIfNeeded(
  text: string,
  hint?: string
): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const truncated = text.slice(0, CHARACTER_LIMIT);
  const message = hint
    ? `\n\n---\n[Response truncated at ${CHARACTER_LIMIT.toLocaleString()} characters. ${hint}]`
    : `\n\n---\n[Response truncated at ${CHARACTER_LIMIT.toLocaleString()} characters. Use filters or pagination to narrow results.]`;
  return truncated + message;
}

export function paginationFooter(
  totalCount: number,
  pageNumber: number,
  hasMore: boolean
): string {
  const lines = [`---`, `Page ${pageNumber} | ${totalCount} total results`];
  if (hasMore) {
    lines.push(
      `More results available — use page_number: ${pageNumber + 1} to see next page`
    );
  }
  return lines.join("\n");
}

// ─── ITGlue API Client ───────────────────────────────────────────

/** getMany plus the JSON:API `included` sideload (deserialized). */
export interface GetManyRawResult<T extends Record<string, unknown>>
  extends PaginatedResult<T> {
  included: Record<string, unknown>[];
}

export class ITGlueClient {
  private readonly http: AxiosInstance;
  private readonly retryOn429: boolean;
  private _requestCount = 0;

  constructor(config: ITGlueClientConfig) {
    this.retryOn429 = config.retryOn429 ?? false;
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: 30_000,
      headers: {
        "x-api-key": config.apiKey,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
    });
  }

  /**
   * Run a request, optionally retrying on HTTP 429. When retryOn429 is false
   * (the default) this awaits `fn` once, so behavior is unchanged for CRUD
   * tools. When enabled it honors a numeric Retry-After header, otherwise backs
   * off exponentially, up to RETRY_MAX_ATTEMPTS.
   */
  /** Total HTTP requests issued (including retries). Used for build reports. */
  get requestCount(): number {
    return this._requestCount;
  }

  private async withRetry<R>(fn: () => Promise<R>): Promise<R> {
    let attempt = 0;
    for (;;) {
      this._requestCount++;
      try {
        return await fn();
      } catch (error) {
        attempt++;
        const status =
          error instanceof AxiosError ? error.response?.status : undefined;
        if (
          !this.retryOn429 ||
          status !== 429 ||
          attempt >= RETRY_MAX_ATTEMPTS
        ) {
          throw error;
        }
        const header =
          error instanceof AxiosError
            ? error.response?.headers?.["retry-after"]
            : undefined;
        const retryAfter = Number(header);
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : RETRY_BASE_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async getOne<T extends Record<string, unknown>>(
    path: string,
    params?: Record<string, string | number>
  ): Promise<T> {
    const response = await this.withRetry(() =>
      this.http.get<JsonApiResponse>(path, { params })
    );
    const data = response.data.data;
    if (Array.isArray(data)) {
      throw new Error("Expected single resource but received array");
    }
    return deserializeResource<T>(data);
  }

  /**
   * Like getMany, but also returns the JSON:API `included` sideload array
   * (deserialized). Used to consume `include=sections` when the API supports it.
   */
  async getManyRaw<T extends Record<string, unknown>>(
    path: string,
    params?: Record<string, string | number>
  ): Promise<GetManyRawResult<T>> {
    const response = await this.withRetry(() =>
      this.http.get<JsonApiResponse>(path, { params })
    );
    const data = response.data.data;
    const items = Array.isArray(data) ? data : [data];

    const meta = response.data.meta;
    const totalCount = meta?.["total-count"] ?? items.length;
    const currentPage = meta?.["current-page"] ?? 1;
    const nextPage = meta?.["next-page"] ?? null;
    const pageSize = params?.["page[size]"]
      ? Number(params["page[size]"])
      : items.length;

    const included = (response.data.included ?? []).map((resource) =>
      deserializeResource(resource)
    );

    return {
      data: items.map((item) => deserializeResource<T>(item)),
      total_count: totalCount,
      page_number: currentPage,
      page_size: pageSize,
      has_more: nextPage !== null,
      next_page: nextPage,
      included,
    };
  }

  async getMany<T extends Record<string, unknown>>(
    path: string,
    params?: Record<string, string | number>
  ): Promise<PaginatedResult<T>> {
    const { included: _included, ...result } = await this.getManyRaw<T>(
      path,
      params
    );
    return result;
  }

  /**
   * Fetch every page of a paginated endpoint and return the concatenated
   * results. Pages are requested at the maximum page size to minimize round
   * trips. Iteration stops when the API stops advertising a next page, and is
   * additionally protected by three guards against non-termination:
   *   - a hard page cap (GET_ALL_MAX_PAGES),
   *   - an empty page (nothing left to accumulate),
   *   - a next_page value that does not strictly advance.
   */
  async getAll<T extends Record<string, unknown>>(
    path: string,
    params?: Record<string, string | number>
  ): Promise<T[]> {
    const all: T[] = [];
    let pageNumber = 1;

    for (let page = 0; page < GET_ALL_MAX_PAGES; page++) {
      const result = await this.getMany<T>(path, {
        ...params,
        "page[number]": pageNumber,
        "page[size]": MAX_PAGE_SIZE,
      });

      if (result.data.length === 0) break;
      all.push(...result.data);

      if (!result.has_more || result.next_page === null) break;
      if (result.next_page <= pageNumber) break;

      pageNumber = result.next_page;
    }

    return all;
  }

  async post<T extends Record<string, unknown>>(
    path: string,
    body: JsonApiRequestBody
  ): Promise<T> {
    const response = await this.http.post<JsonApiResponse>(path, body);
    return deserializeOne<T>(response.data.data, "create");
  }

  async patch<T extends Record<string, unknown>>(
    path: string,
    body: JsonApiRequestBody
  ): Promise<T> {
    const response = await this.http.patch<JsonApiResponse>(path, body);
    return deserializeOne<T>(response.data.data, "update");
  }

  async delete(
    path: string,
    body?: Record<string, unknown>
  ): Promise<void> {
    await this.http.delete(path, { data: body });
  }

  async postAction<T extends Record<string, unknown>>(
    path: string,
    body?: Record<string, unknown>
  ): Promise<T | null> {
    const response = await this.http.post<JsonApiResponse | null>(path, body);
    return deserializeOptional<T>(response.data?.data);
  }

  async patchAction<T extends Record<string, unknown>>(
    path: string,
    body?: Record<string, unknown>
  ): Promise<T | null> {
    const response = await this.http.patch<JsonApiResponse | null>(path, body);
    return deserializeOptional<T>(response.data?.data);
  }
}
