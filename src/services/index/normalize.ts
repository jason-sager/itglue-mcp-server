import { stripHtml } from "../itglue-client.js";
import { INDEX_MIN_TERM_LEN, INDEX_MAX_TERM_LEN } from "../../constants.js";
import { STOPWORDS } from "./stopwords.js";

// Tokens keep internal dots/dashes/underscores so identifiers survive intact:
//   10.0.0.1, v1.2, acme-vpn, db_host  ->  single tokens.
// Leading/trailing separators are excluded by requiring an alphanumeric edge.
const TOKEN_RE = /[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/g;

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_RE) ?? [];
  const out: string[] = [];
  for (const t of matches) {
    if (t.length < INDEX_MIN_TERM_LEN || t.length > INDEX_MAX_TERM_LEN) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** Sorted, deduplicated term set from plain text (titles, queries). */
export function normalizeTextToTerms(text: string): string[] {
  return [...new Set(tokenize(text ?? ""))].sort();
}

/**
 * Sorted, deduplicated term set from HTML document content. HTML is stripped
 * first; the result is a bag of keywords from which the original prose cannot
 * be reconstructed (order and repetition are discarded).
 */
export function normalizeToTerms(html: string): string[] {
  return normalizeTextToTerms(stripHtml(html ?? ""));
}

/** Normalize a search query the same way, for keyword-overlap matching. */
export function normalizeQuery(query: string): string[] {
  return normalizeTextToTerms(query ?? "");
}

/** Count of shared terms between two sorted term sets (both from normalize*). */
export function termOverlap(queryTerms: string[], docTerms: string[]): string[] {
  if (queryTerms.length === 0 || docTerms.length === 0) return [];
  const docSet = new Set(docTerms);
  return queryTerms.filter((t) => docSet.has(t));
}
