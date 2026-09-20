/**
 * Isomorphic mapping between the *search representation* of a text
 * (NFC/NFD-normalized, optionally mark-stripped and case-folded) and the
 * original text.
 *
 * Every offset crossing the server/client boundary is a UTF-16 code unit
 * offset (the native unit of JS strings). The client never normalizes on its
 * own: it only consumes the ranges produced here.
 *
 * Guarantees:
 *  - every folded position maps back to whole source grapheme clusters, so
 *    highlights never split surrogate pairs or combining-mark sequences;
 *  - 1:many folds (ß -> "ss", ﬁ -> "fi") and many:1 folds
 *    (é -> "e", 👨‍👩‍👧 -> itself vs. its code units) both expand to the
 *    complete source run;
 *  - folded-away clusters (e.g. orphan combining marks) attach to the
 *    neighbouring hit instead of leaving holes.
 */

export interface FoldOptions {
  /** Case-insensitive matching, including ß -> ss and ligature expansion. */
  caseFold?: boolean;
  /** Remove diacritical marks after NFD decomposition. */
  stripMarks?: boolean;
  /** Apply Turkish dotted/dotless I rules (only meaningful with caseFold). */
  turkish?: boolean;
}

/** Half-open UTF-16 range into some string. */
export interface Range {
  start: number;
  end: number;
}

export interface GraphemeCluster {
  /** UTF-16 offset of the cluster start in the original text. */
  index: number;
  text: string;
}

export interface Span {
  /** Source range [start,end) in UTF-16 code units. */
  start: number;
  end: number;
  /** Folded text emitted by this source run. */
  folded: string;
}

export interface FoldIndex {
  original: string;
  folded: string;
  spans: Span[];
  /**
   * For each UTF-16 code unit of `folded`, the index of the span that
   * produced it. A span covering 1:many folds (ß -> "ss") owns several
   * consecutive entries.
   */
  owner: number[];
  /**
   * Folded-side offsets at span boundaries. Matches are only accepted when
   * both endpoints land on one of these, so folding never matches inside a
   * grapheme (e.g. query "s" must not highlight half of ß -> "ss").
   */
  boundaries: number[];
}

// ---------------------------------------------------------------------------
// Grapheme segmentation
// ---------------------------------------------------------------------------

type SegmenterLike = {
  segment(input: string): Iterable<{ index: number; segment: string }>;
};

function createGraphemeSegmenter(): SegmenterLike | null {
  const Ctor = (Intl as unknown as { Segmenter?: new (
    locales?: string | string[],
    options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
  ) => SegmenterLike }).Segmenter;
  if (!Ctor) return null;
  return new Ctor(undefined, { granularity: 'grapheme' });
}

/**
 * Fallback for engines without Intl.Segmenter. Handles code points with
 * trailing combining marks, regional indicator pairs and ZWJ/modifier emoji
 * sequences; good enough to keep surrogate pairs and combining sequences
 * intact.
 */
const FALLBACK_GRAPHEME =
  /\r\n|\r|\n|(?:[\u{1F1E6}-\u{1F1FF}]){2}|(?:\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)*)|[^\p{Mn}\r\n]\p{Mn}*|\p{Mn}/gu;

export function segmentGraphemes(text: string): GraphemeCluster[] {
  const segmenter = createGraphemeSegmenter();
  if (segmenter) {
    const clusters: GraphemeCluster[] = [];
    for (const part of segmenter.segment(text)) {
      clusters.push({ index: part.index, text: part.segment });
    }
    return clusters;
  }
  const clusters: GraphemeCluster[] = [];
  for (const match of text.matchAll(FALLBACK_GRAPHEME)) {
    clusters.push({ index: match.index ?? 0, text: match[0] });
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/** Fold a single grapheme cluster into its search representation. */
function foldCluster(input: string, options: FoldOptions): string {
  // Baseline: NFD makes NFC and NFD source text compare equal regardless of
  // which optional flags are on.
  let s = input.normalize('NFD');

  if (options.caseFold) {
    // Turkish dotted/dotless pairings run before the generic lowercase
    // pass, which would otherwise collapse both forms onto ASCII i:
    //   \u0130 (I + combining dot above) -> i ; capital I -> \u0131 when Turkish.
    s = s.replace(/I\u0307|\u0130/g, 'i');
    if (options.turkish) {
      // Both capital I and lowercase i are dotless in Turkish; lowercase i
      // is handled here because toLowerCase() would leave it as ASCII i.
      s = s.replace(/[Ii]/g, '\u0131');
    }
    // Expansions: one source character corresponds to several folded ones.
    s = s.replace(/[\u00df\u1e9e]/g, 'ss');
    s = s.replace(/\u017f/g, 's');
    s = s.replace(/\ufb00/g, 'ff');
    s = s.replace(/\ufb01/g, 'fi');
    s = s.replace(/\ufb02/g, 'fl');
    s = s.replace(/\ufb03/g, 'ffi');
    s = s.replace(/\ufb04/g, 'ffl');
    s = s.replace(/[\ufb05\ufb06]/g, 'st');
    // Generic lowercase never touches the already-lowercase i/\u0131.
    s = s.toLowerCase();
  }

  if (options.stripMarks) {
    s = s.replace(/\p{Mn}/gu, '');
  }
  return s;
}

export function buildFoldIndex(text: string, options: FoldOptions): FoldIndex {
  const rawSpans: Array<{ start: number; end: number; folded: string }> = [];
  // Intervals that fold away (stripped orphan marks, ...).
  const empty: Array<[number, number]> = [];

  for (const cluster of segmentGraphemes(text)) {
    const start = cluster.index;
    const end = cluster.index + cluster.text.length;
    const folded = foldCluster(cluster.text, options);
    if (folded.length > 0) rawSpans.push({ start, end, folded });
    else empty.push([start, end]);
  }

  // Attach each fold-away interval to its neighbours: interior intervals
  // extend both the preceding and following span, so a match touching either
  // side (and a match spanning it) covers the whole interval. Leading and
  // trailing intervals attach to their single neighbour.
  for (const [start, end] of empty) {
    let lo = -1;
    let hi = -1;
    rawSpans.forEach((span, i) => {
      if (span.end <= start) lo = i;
      if (span.start >= end && hi < 0) hi = i;
    });
    if (lo >= 0) rawSpans[lo].end = Math.max(rawSpans[lo].end, end);
    if (hi >= 0) rawSpans[hi].start = Math.min(rawSpans[hi].start, start);
  }

  // Note: spans may now overlap on shared empty intervals. Overlap is fine
  // for mapping (hits merge later); owner positions stay unambiguous.
  const spans: Span[] = [];
  const owner: number[] = [];
  const foldedParts: string[] = [];
  const boundaries: number[] = [0];
  let foldedOffset = 0;
  rawSpans.forEach((span, i) => {
    spans.push(span);
    foldedParts.push(span.folded);
    for (let k = 0; k < span.folded.length; k += 1) owner.push(i);
    foldedOffset += span.folded.length;
    boundaries.push(foldedOffset);
  });

  return { original: text, folded: foldedParts.join(''), spans, owner, boundaries };
}

/**
 * Convert a half-open UTF-16 range in the folded string to the UTF-16 range
 * in the original text, expanded to cover every involved source grapheme
 * (and any folded-away cluster in between).
 */
export function mapFoldedRange(index: FoldIndex, foldedStart: number, foldedEnd: number): Range {
  if (index.spans.length === 0 || foldedEnd <= foldedStart) {
    return { start: 0, end: 0 };
  }
  const first = index.owner[Math.max(0, Math.min(foldedStart, index.owner.length - 1))];
  const last = index.owner[Math.max(0, Math.min(foldedEnd - 1, index.owner.length - 1))];
  return {
    start: index.spans[first].start,
    end: index.spans[last].end,
  };
}

/** Merge overlapping ranges; merely adjacent hits stay separate. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    // Merge only strictly overlapping ranges; merely adjacent hits stay
    // separate so repeated neighbouring matches remain distinct.
    if (previous && range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** All matches of `queryText` in `text`, as original-text UTF-16 ranges. */
export function findMatches(queryText: string, text: string, options: FoldOptions): Range[] {
  const query = buildFoldIndex(queryText, options);
  const target = buildFoldIndex(text, options);
  if (query.folded.length === 0) return [];

  const boundarySet = new Set(target.boundaries);
  const ranges: Range[] = [];
  let from = 0;
  while (from <= target.folded.length) {
    const at = target.folded.indexOf(query.folded, from);
    if (at < 0) break;
    const endsAt = at + query.folded.length;
    // Both endpoints must land on folded grapheme boundaries, otherwise a
    // short query could match inside an expanded span (e.g. "s" against
    // half of ß -> "ss") or at a dangling combining mark.
    if (boundarySet.has(at) && boundarySet.has(endsAt)) {
      ranges.push(mapFoldedRange(target, at, endsAt));
      from = endsAt;
    } else {
      from = at + 1;
    }
  }
  return mergeRanges(ranges);
}

// ---------------------------------------------------------------------------
// Snippet construction (ranges stay in the same UTF-16 coordinate space)
// ---------------------------------------------------------------------------

export interface Snippet {
  text: string;
  /** Hit ranges relative to `text` (add `start` to get offsets in original). */
  ranges: Range[];
  start: number;
  end: number;
  prefixEllipsis: boolean;
  suffixEllipsis: boolean;
}

const SNIPPET_RADIUS = 24;
const SNIPPET_MAX_LENGTH = 96;

function intersection(a: Range, b: Range): Range | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/**
 * Trim `text` around its hit ranges, always snapping to grapheme boundaries
 * and never cutting a hit. Output ranges are relative to the snippet text,
 * preserving their position relative to the cut window.
 */
export function buildSnippet(
  text: string,
  hitRanges: Range[],
  options: { radius?: number; maxLength?: number } = {},
): Snippet {
  const radius = options.radius ?? SNIPPET_RADIUS;
  const maxLength = options.maxLength ?? SNIPPET_MAX_LENGTH;
  const boundaries = [0, ...segmentGraphemes(text).slice(1).map((c) => c.index), text.length];

  const snapStart = (offset: number) =>
    boundaries.reduce((best, b) => (b <= offset ? b : best), 0);
  const snapEnd = (offset: number) =>
    boundaries.find((b) => b >= offset) ?? text.length;

  if (hitRanges.length === 0) {
    const end = snapEnd(Math.min(maxLength, text.length));
    return {
      text: text.slice(0, end),
      ranges: [],
      start: 0,
      end,
      prefixEllipsis: false,
      suffixEllipsis: end < text.length,
    };
  }

  const hits = mergeRanges(hitRanges);
  const firstHit = hits[0];
  const lastHit = hits[hits.length - 1];

  let start = snapStart(Math.max(0, firstHit.start - radius));
  let end = snapEnd(Math.min(text.length, lastHit.end + radius));

  // Shrink the non-hit slack, one grapheme at a time, from the side with
  // more room. Stops once hits themselves fill the window.
  while (end - start > maxLength) {
    const slackLeft = firstHit.start - start;
    const slackRight = end - lastHit.end;
    if (slackLeft <= 0 && slackRight <= 0) break;
    if (slackRight > slackLeft) {
      const previous = snapStart(end - 1);
      if (previous <= lastHit.end) break;
      end = previous;
    } else {
      const next = snapEnd(start + 1);
      if (next >= firstHit.start) break;
      start = next;
    }
  }

  const windowRange: Range = { start, end };
  const ranges = hits
    .map((hit) => intersection(hit, windowRange))
    .filter((hit): hit is Range => hit !== null)
    .map((hit) => ({ start: hit.start - start, end: hit.end - start }));

  return {
    text: text.slice(start, end),
    ranges,
    start,
    end,
    prefixEllipsis: start > 0,
    suffixEllipsis: end < text.length,
  };
}

// ---------------------------------------------------------------------------
// Virtual list windowing (pure helper: recycled rows always render from the
// current item's props, never from retained per-row highlight state)
// ---------------------------------------------------------------------------

export interface VisibleWindow {
  startIndex: number;
  endIndex: number;
  /** translateY offset for the first rendered row. */
  offset: number;
}

export function getVisibleWindow(
  scrollTop: number,
  viewportHeight: number,
  itemCount: number,
  rowHeight: number,
  overscan = 4,
): VisibleWindow {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const last = Math.min(itemCount, Math.floor(scrollTop / rowHeight) + visibleCount + overscan);
  return { startIndex: first, endIndex: last, offset: first * rowHeight };
}
