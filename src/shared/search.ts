// Shared search core: folds text into a normalized "search representation"
// while keeping a grapheme-level map back to original UTF-16 offsets.
//
// The server searches the normalized string, then converts every hit back to
// original-text UTF-16 ranges through this map. Ranges are always expanded to
// full grapheme boundaries, so a highlight never splits a surrogate pair, a
// combining sequence, or an emoji ZWJ cluster — no matter whether one
// normalized char came from many original chars (é = e + ◌́) or one original
// char became many normalized chars (ß → ss).

/** Half-open UTF-16 code-unit range. */
export type Range = {start: number; end: number};

export type FoldOptions = {
  /** Case folding: lowercases and folds ß/ẞ → ss (İ → i via lowercase + mark strip). */
  caseFold?: boolean;
  /** Diacritic folding: strips all combining marks after NFD decomposition. */
  diacriticFold?: boolean;
};

type ResolvedFoldOptions = {caseFold: boolean; diacriticFold: boolean};

/** One entry per source grapheme, in document order. */
export type MapEntry = {
  /** Range in the normalized string ([nStart, nEnd); empty when the grapheme folded away). */
  nStart: number;
  nEnd: number;
  /** Range in the original string (UTF-16 code units). */
  oStart: number;
  oEnd: number;
};

export type SearchIndex = {
  /** The normalized search representation of the text. */
  normalized: string;
  entries: MapEntry[];
};

export type Snippet = {
  /** Stable identity: original hit range, used as list key. */
  id: string;
  /** Snippet text sliced from the ORIGINAL string. */
  text: string;
  /** Hit ranges relative to `text` (UTF-16, grapheme aligned). */
  ranges: Range[];
  ellipsisBefore: boolean;
  ellipsisAfter: boolean;
};

const graphemeSegmenter = new Intl.Segmenter('und', {granularity: 'grapheme'});
const MARK = /\p{M}/gu;

function resolveOptions(options: FoldOptions): ResolvedFoldOptions {
  return {
    caseFold: options.caseFold !== false,
    diacriticFold: options.diacriticFold !== false,
  };
}

/**
 * Folds a single grapheme into its search form. Case folding runs before mark
 * stripping so that İ (U+0130) lowercases to "i" + U+0307 and the combining
 * dot is then removed; ß/ẞ fold to "ss" explicitly (JS has no casefold API).
 */
function foldGrapheme(grapheme: string, options: ResolvedFoldOptions): string {
  let out = grapheme;
  if (options.caseFold) out = out.toLowerCase().replaceAll('ß', 'ss');
  // Always decompose so canonically equivalent text (NFC vs NFD) compares equal.
  out = out.normalize('NFD');
  if (options.diacriticFold) out = out.replace(MARK, '');
  return out;
}

/**
 * Builds the normalized search string plus the per-grapheme map from
 * normalized offsets back to original UTF-16 offsets.
 */
export function buildSearchIndex(text: string, options: FoldOptions = {}): SearchIndex {
  const resolved = resolveOptions(options);
  const entries: MapEntry[] = [];
  let normalized = '';
  for (const part of graphemeSegmenter.segment(text)) {
    const folded = foldGrapheme(part.segment, resolved);
    entries.push({
      nStart: normalized.length,
      nEnd: normalized.length + folded.length,
      oStart: part.index,
      oEnd: part.index + part.segment.length,
    });
    normalized += folded;
  }
  return {normalized, entries};
}

/**
 * Folds a query with the exact same per-grapheme pipeline used for the index,
 * so query and text always live in the same normalized space.
 */
export function foldQuery(query: string, options: FoldOptions = {}): string {
  const resolved = resolveOptions(options);
  let out = '';
  for (const part of graphemeSegmenter.segment(query)) out += foldGrapheme(part.segment, resolved);
  return out;
}

/** Finds non-overlapping hits of the folded query in the normalized string. */
export function findHits(normalized: string, foldedQuery: string): Range[] {
  const hits: Range[] = [];
  if (!foldedQuery) return hits;
  let from = 0;
  for (;;) {
    const at = normalized.indexOf(foldedQuery, from);
    if (at < 0) break;
    hits.push({start: at, end: at + foldedQuery.length});
    from = at + foldedQuery.length;
  }
  return hits;
}

/**
 * Converts normalized-space hits (ascending) into original UTF-16 ranges.
 * Each hit is expanded to the full span of every source grapheme it touches,
 * which is what keeps surrogate pairs, combining sequences and ZWJ clusters
 * intact and covers both 1→n and n→1 fold directions.
 *
 * Hits that would cut through a grapheme's folded form are discarded: a match
 * must start and end on normalized grapheme boundaries. This keeps folding
 * options meaningful — e.g. with diacritic folding off, "cafe" must not match
 * the "cafe" prefix of decomposed "café" (é = e + U+0301), and a lone "s"
 * must not match half of the folded "ss" produced by ß.
 */
export function toOriginalRanges(index: SearchIndex, hits: Range[]): Range[] {
  const out: Range[] = [];
  const {entries} = index;
  const nStarts = new Set<number>();
  const nEnds = new Set<number>();
  for (const entry of entries) {
    nStarts.add(entry.nStart);
    nEnds.add(entry.nEnd);
  }
  let cursor = 0;
  for (const hit of hits) {
    if (!nStarts.has(hit.start) || !nEnds.has(hit.end)) continue;
    while (cursor < entries.length && entries[cursor].nEnd <= hit.start) cursor++;
    let start = -1;
    let end = -1;
    for (let i = cursor; i < entries.length && entries[i].nStart < hit.end; i++) {
      const entry = entries[i];
      if (entry.nEnd <= hit.start) continue; // zero-width entry exactly at the edge
      if (start < 0) start = entry.oStart;
      end = entry.oEnd;
    }
    if (start >= 0) out.push({start, end});
  }
  return out;
}

function graphemeBoundaries(index: SearchIndex, textLength: number): number[] {
  const boundaries = index.entries.map(entry => entry.oStart);
  boundaries.push(textLength);
  return boundaries;
}

/**
 * Builds a snippet window around `hit` in ORIGINAL coordinates. Window edges
 * snap inward to grapheme boundaries (never slicing a cluster), and every
 * overlapping hit is shifted into snippet-relative offsets so ranges stay
 * valid after the text is trimmed on both sides.
 */
export function makeSnippet(
  index: SearchIndex,
  text: string,
  hit: Range,
  allHits: Range[],
  context: number,
): Snippet {
  const boundaries = graphemeBoundaries(index, text.length);
  const rawStart = Math.max(0, hit.start - context);
  const rawEnd = Math.min(text.length, hit.end + context);
  // Snap window edges inward to grapheme boundaries so trimming never slices
  // a cluster (surrogate pair, combining sequence, ZWJ emoji).
  let start = text.length;
  for (const boundary of boundaries) {
    if (boundary >= rawStart) {
      start = boundary;
      break;
    }
  }
  let end = 0;
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (boundaries[i] <= rawEnd) {
      end = boundaries[i];
      break;
    }
  }
  const ranges = allHits
    .filter(other => other.end > start && other.start < end)
    .map(other => ({
      start: Math.max(other.start, start) - start,
      end: Math.min(other.end, end) - start,
    }));
  return {
    id: `${hit.start}:${hit.end}`,
    text: text.slice(start, end),
    ranges,
    ellipsisBefore: start > 0,
    ellipsisAfter: end < text.length,
  };
}

export type SearchResult = {
  /** Hit ranges in ORIGINAL-text UTF-16 offsets, ascending, non-overlapping. */
  hits: Range[];
  /** One snippet per hit, ranges relative to each snippet's text. */
  snippets: Snippet[];
};

/**
 * Searches `text` for `query` under the given folding options and returns hit
 * ranges in original UTF-16 coordinates plus truncation-safe snippets. This is
 * the single place where normalization happens — consumers only see
 * structured ranges.
 */
export function searchText(
  text: string,
  query: string,
  options: FoldOptions & {context?: number} = {},
): SearchResult {
  const resolved = resolveOptions(options);
  const rawContext = options.context;
  const context = Number.isFinite(rawContext)
    ? Math.max(0, Math.min(200, Math.floor(rawContext as number)))
    : 40;
  const index = buildSearchIndex(text, resolved);
  const folded = foldQuery(query, resolved);
  const hits = toOriginalRanges(index, findHits(index.normalized, folded));
  const snippets = hits.map(hit => makeSnippet(index, text, hit, hits, context));
  return {hits, snippets};
}

export type Segment = {text: string; hit: boolean};

/**
 * Splits text into plain/highlighted segments for rendering. Tolerates
 * unsorted, overlapping or out-of-bounds ranges and never emits empty
 * segments, so adjacent hits render as adjacent marks without gaps.
 */
export function segments(text: string, ranges: Range[]): Segment[] {
  const sorted = ranges
    .filter(range => range.end > range.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Segment[] = [];
  let pos = 0;
  for (const range of sorted) {
    const start = Math.max(range.start, pos);
    const end = Math.min(range.end, text.length);
    if (start > pos) out.push({text: text.slice(pos, start), hit: false});
    if (end > start) out.push({text: text.slice(start, end), hit: true});
    pos = Math.max(pos, end);
  }
  if (pos < text.length) out.push({text: text.slice(pos), hit: false});
  return out;
}
