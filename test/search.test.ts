import {describe, expect, it} from 'vitest';
import {
  buildSearchIndex,
  findHits,
  foldQuery,
  searchText,
  segments,
  toOriginalRanges,
  type Range,
} from '../src/shared/search';

// Explicit escapes so the fixtures survive any editor-side NFC normalization.
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'; // 4 emoji + 3 ZWJ = 11 UTF-16 units, one grapheme
const E_NFD = 'e\u0301'; // e + combining acute
const CAFE_NFD = `Caf${E_NFD}`;
const CAFE_NFC = 'Caf\u00e9';
const NAIVE_NFD = 'nai\u0308ve'; // ï as i + combining diaeresis
const LONE_MARK = '\u0301'; // combining acute with no base char

function boundariesOf(text: string): Set<number> {
  const set = new Set<number>([0, text.length]);
  for (const part of new Intl.Segmenter('und', {granularity: 'grapheme'}).segment(text)) {
    set.add(part.index);
    set.add(part.index + part.segment.length);
  }
  return set;
}

function expectOnBoundaries(text: string, ranges: Range[]) {
  const boundaries = boundariesOf(text);
  for (const range of ranges) {
    expect(boundaries.has(range.start), `start ${range.start} of ${JSON.stringify(range)}`).toBe(true);
    expect(boundaries.has(range.end), `end ${range.end} of ${JSON.stringify(range)}`).toBe(true);
  }
}

describe('folding pipeline', () => {
  it('folds the query with the same pipeline as the index', () => {
    const text = `Straße İSTANBUL ${CAFE_NFD} ${FAMILY} ﬁ`;
    expect(foldQuery(text)).toBe(buildSearchIndex(text).normalized);
  });

  it('keeps case folding when diacritic folding is off and vice versa', () => {
    expect(searchText(CAFE_NFC, 'cafe', {diacriticFold: false}).hits).toEqual([]);
    expect(searchText('Cafe', 'cafe', {caseFold: false}).hits).toEqual([]);
    expect(searchText('Cafe', 'Cafe', {caseFold: false}).hits).toEqual([{start: 0, end: 4}]);
  });

  it('still matches canonically equivalent text when diacritic folding is off', () => {
    const hits = searchText(CAFE_NFD, 'café', {diacriticFold: false}).hits;
    expect(hits).toEqual([{start: 0, end: 5}]);
    expect(CAFE_NFD.slice(hits[0].start, hits[0].end)).toBe(CAFE_NFD);
  });

  it('rejects matches that would cut through a grapheme fold', () => {
    // With diacritics significant, "cafe" must not match the prefix of "café".
    expect(searchText(CAFE_NFD, 'cafe', {diacriticFold: false}).hits).toEqual([]);
    // "s" matches the real S at position 0, but not half of the ß fold ("ss").
    expect(searchText('Straße', 's').hits).toEqual([{start: 0, end: 1}]);
  });
});

describe('NFC/NFD equivalence', () => {
  it('highlights the whole word in NFC text', () => {
    const {hits} = searchText(CAFE_NFC, 'cafe');
    expect(hits).toEqual([{start: 0, end: 4}]);
    expect(CAFE_NFC.slice(hits[0].start, hits[0].end)).toBe(CAFE_NFC);
  });

  it('highlights the whole word in NFD text, including the combining mark', () => {
    expect(CAFE_NFD.length).toBe(5);
    const {hits} = searchText(CAFE_NFD, 'cafe');
    expect(hits).toEqual([{start: 0, end: 5}]);
    expect(CAFE_NFD.slice(hits[0].start, hits[0].end)).toBe(CAFE_NFD);
  });

  it('produces equivalent highlights for NFC and NFD forms of the same word', () => {
    const nfc = searchText(CAFE_NFC, 'cafe').hits;
    const nfd = searchText(CAFE_NFD, 'cafe').hits;
    expect(nfc).toHaveLength(1);
    expect(nfd).toHaveLength(1);
    expect(CAFE_NFC.slice(nfc[0].start, nfc[0].end)).toBe(CAFE_NFC);
    expect(CAFE_NFD.slice(nfd[0].start, nfd[0].end)).toBe(CAFE_NFD);
  });

  it('matches a mid-word combining sequence without cutting it', () => {
    const {hits} = searchText(NAIVE_NFD, 'naive');
    expect(hits).toEqual([{start: 0, end: 6}]);
    expectOnBoundaries(NAIVE_NFD, hits);
  });
});

describe('ß case folding', () => {
  it('matches ß against ss in both directions', () => {
    expect(searchText('Straße', 'strasse').hits).toEqual([{start: 0, end: 6}]);
    expect(searchText('STRASSE', 'straße').hits).toEqual([{start: 0, end: 7}]);
    expect(searchText('Straße', 'STRASSE').hits).toEqual([{start: 0, end: 6}]);
  });

  it('maps the folded ss back to the single ß grapheme', () => {
    const text = 'Straße';
    const {hits} = searchText(text, 'ss');
    // Normalized hit is [4,6) inside "strasse"; it must map back to the ß
    // grapheme at [4,5), not to two phantom code units.
    expect(hits).toEqual([{start: 4, end: 5}]);
    expect(text.slice(hits[0].start, hits[0].end)).toBe('ß');
  });

  it('folds capital ẞ (U+1E9E) to ss as well', () => {
    expect(searchText('STRAẞE', 'strasse').hits).toEqual([{start: 0, end: 6}]);
    expect(searchText('ẞ', 'ss').hits).toEqual([{start: 0, end: 1}]);
  });
});

describe('Turkish I', () => {
  it('matches dotted İ and ASCII I against i', () => {
    expect(searchText('İSTANBUL', 'istanbul').hits).toEqual([{start: 0, end: 8}]);
    expect(searchText('Istanbul', 'istanbul').hits).toEqual([{start: 0, end: 8}]);
    expect(searchText('istanbul', 'İSTANBUL').hits).toEqual([{start: 0, end: 8}]);
  });

  it('keeps dotless ı distinct from i', () => {
    expect(searchText('kırmızı', 'kirmizi').hits).toEqual([]);
    expect(searchText('kırmızı', 'kırmızı').hits).toEqual([{start: 0, end: 7}]);
  });
});

describe('emoji and surrogate pairs', () => {
  it('treats a ZWJ family emoji as one grapheme', () => {
    expect(FAMILY.length).toBe(11);
    const text = `${FAMILY} family`;
    const {hits} = searchText(text, 'family');
    expect(hits).toEqual([{start: 12, end: 18}]);
    expectOnBoundaries(text, hits);
  });

  it('highlights the entire ZWJ cluster when the emoji itself matches', () => {
    const text = `a ${FAMILY} b`;
    const {hits} = searchText(text, FAMILY);
    expect(hits).toEqual([{start: 2, end: 13}]);
    expect(text.slice(hits[0].start, hits[0].end)).toBe(FAMILY);
  });

  it('never splits a surrogate pair', () => {
    const text = 'a😀b';
    const {hits} = searchText(text, '😀');
    expect(hits).toEqual([{start: 1, end: 3}]);
    expectOnBoundaries(text, hits);
    expect(searchText(text, 'b').hits).toEqual([{start: 3, end: 4}]);
  });
});

describe('adjacent and multiple hits', () => {
  it('finds non-overlapping adjacent hits', () => {
    expect(searchText('aaaa', 'aa').hits).toEqual([
      {start: 0, end: 2},
      {start: 2, end: 4},
    ]);
  });

  it('renders adjacent hits as adjacent marks without empty segments', () => {
    const segs = segments('aaaa', [
      {start: 0, end: 2},
      {start: 2, end: 4},
    ]);
    expect(segs).toEqual([
      {text: 'aa', hit: true},
      {text: 'aa', hit: true},
    ]);
  });

  it('keeps hits separated by plain text distinct', () => {
    const text = 'ab ab';
    const {hits} = searchText(text, 'ab');
    expect(hits).toEqual([
      {start: 0, end: 2},
      {start: 3, end: 5},
    ]);
    expect(segments(text, hits)).toEqual([
      {text: 'ab', hit: true},
      {text: ' ', hit: false},
      {text: 'ab', hit: true},
    ]);
  });

  it('collects adjacent folded hits across a ß boundary', () => {
    const text = 'ßß'; // folds to "ssss"
    const {hits} = searchText(text, 'ss');
    expect(hits).toEqual([
      {start: 0, end: 1},
      {start: 1, end: 2},
    ]);
    expectOnBoundaries(text, hits);
  });
});

describe('snippet truncation', () => {
  const text = 'x'.repeat(100) + 'needle' + 'y'.repeat(100);

  it('trims around the hit and keeps ranges relative to the snippet', () => {
    const {hits, snippets} = searchText(text, 'needle', {context: 20});
    expect(hits).toEqual([{start: 100, end: 106}]);
    expect(snippets).toHaveLength(1);
    const snippet = snippets[0];
    expect(snippet.text).toBe(text.slice(80, 126));
    expect(snippet.text.length).toBe(46);
    expect(snippet.ranges).toEqual([{start: 20, end: 26}]);
    expect(snippet.text.slice(20, 26)).toBe('needle');
    expect(snippet.ellipsisBefore).toBe(true);
    expect(snippet.ellipsisAfter).toBe(true);
  });

  it('drops the ellipsis when the window reaches the text edges', () => {
    const {snippets} = searchText('needle', 'needle', {context: 20});
    expect(snippets[0].text).toBe('needle');
    expect(snippets[0].ranges).toEqual([{start: 0, end: 6}]);
    expect(snippets[0].ellipsisBefore).toBe(false);
    expect(snippets[0].ellipsisAfter).toBe(false);
  });

  it('snaps the window edge out of a ZWJ emoji instead of cutting it', () => {
    const padded = 'x'.repeat(40) + FAMILY + 'yyyy' + 'z'.repeat(40); // emoji spans [40,51)
    const {hits, snippets} = searchText(padded, 'yyyy', {context: 10});
    expect(hits).toEqual([{start: 51, end: 55}]);
    expect(snippets).toHaveLength(1);
    const snippet = snippets[0];
    // Raw window start would be 41, inside the emoji cluster; it must snap to 51.
    expect(snippet.text).toBe(padded.slice(51, 65));
    expect(snippet.ranges).toEqual([{start: 0, end: 4}]);
    expect(snippet.ellipsisBefore).toBe(true);
    expectOnBoundaries(padded, [{start: 51, end: 65}]);
    expectOnBoundaries(snippet.text, snippet.ranges);
  });

  it('snaps the trailing window edge before a combining mark', () => {
    const padded = 'q'.repeat(40) + 'xxxx' + E_NFD + 'y'.repeat(40); // é cluster spans [44,46)
    const {hits, snippets} = searchText(padded, 'xxxx', {context: 1});
    expect(hits).toEqual([{start: 40, end: 44}]);
    expect(snippets).toHaveLength(1);
    const snippet = snippets[0];
    // Raw window end would be 45, inside the é cluster; it must snap to 44.
    expect(snippet.text).toBe(padded.slice(39, 44));
    expect(snippet.ranges).toEqual([{start: 1, end: 5}]);
    expect(snippet.text).not.toContain('\u0301');
    expect(snippet.ellipsisAfter).toBe(true);
  });

  it('keeps every hit inside the window relative and slice-consistent', () => {
    const multi = 'a'.repeat(50) + 'needle one ' + 'b'.repeat(10) + 'needle two' + 'c'.repeat(50);
    const {hits, snippets} = searchText(multi, 'needle', {context: 30});
    expect(hits).toHaveLength(2);
    for (const snippet of snippets) {
      for (const range of snippet.ranges) {
        expect(snippet.text.slice(range.start, range.end)).toBe('needle');
      }
      expectOnBoundaries(snippet.text, snippet.ranges);
    }
    // Both hits fit into one another's window, so each snippet lists both.
    expect(snippets[0].ranges).toHaveLength(2);
    expect(snippets[1].ranges).toHaveLength(2);
  });
});

describe('grapheme-boundary safety across a mixed document', () => {
  const mixed = `${LONE_MARK}Straße İSTANBUL ${CAFE_NFD} ${NAIVE_NFD} ${FAMILY} 😀 ßß kırmızı ﬁx`;
  const queries = ['strasse', 'istanbul', 'cafe', 'naive', FAMILY, '😀', 'ss', 'kırmızı', 'x', 'stra'];

  it('never returns a range boundary inside a grapheme', () => {
    for (const query of queries) {
      const {hits, snippets} = searchText(mixed, query, {context: 12});
      expectOnBoundaries(mixed, hits);
      for (const snippet of snippets) {
        expectOnBoundaries(snippet.text, snippet.ranges);
        for (const range of snippet.ranges) {
          expect(range.end).toBeGreaterThan(range.start);
        }
      }
    }
  });

  it('ignores a leading lone combining mark instead of shifting offsets', () => {
    const text = `${LONE_MARK}abc`;
    const {hits} = searchText(text, 'a');
    expect(hits).toEqual([{start: 1, end: 2}]);
    expect(text.slice(hits[0].start, hits[0].end)).toBe('a');
  });
});

describe('low-level mapping', () => {
  it('maps normalized offsets back through many-to-one and one-to-many folds', () => {
    const text = `aß${E_NFD}`; // a | ß→ss | é(e+◌́)→e ; normalized "asse"
    const index = buildSearchIndex(text);
    expect(index.normalized).toBe('asse');
    // normalized "ss" -> original ß [1,2); whole word -> [0,4)
    expect(toOriginalRanges(index, findHits(index.normalized, 'ss'))).toEqual([{start: 1, end: 2}]);
    expect(toOriginalRanges(index, findHits(index.normalized, 'asse'))).toEqual([{start: 0, end: 4}]);
    // "sse" spans ß and the é cluster -> both source graphemes [1,4)
    expect(toOriginalRanges(index, findHits(index.normalized, 'sse'))).toEqual([{start: 1, end: 4}]);
    // "se" would cut the ß fold in half -> rejected
    expect(toOriginalRanges(index, findHits(index.normalized, 'se'))).toEqual([]);
  });
});

describe('segments', () => {
  it('handles empty input and no ranges', () => {
    expect(segments('', [])).toEqual([]);
    expect(segments('abc', [])).toEqual([{text: 'abc', hit: false}]);
  });

  it('sorts unsorted ranges and clips overlaps and out-of-bounds ranges', () => {
    expect(
      segments('abcdef', [
        {start: 4, end: 6},
        {start: 0, end: 2},
        {start: 1, end: 3},
        {start: -5, end: 1},
        {start: 5, end: 99},
      ]),
    ).toEqual([
      {text: 'a', hit: true},
      {text: 'b', hit: true},
      {text: 'c', hit: true},
      {text: 'd', hit: false},
      {text: 'ef', hit: true},
    ]);
  });

  it('is a pure function of its inputs, so reused rows cannot leak highlights', () => {
    const first = segments('alpha hit', [{start: 6, end: 9}]);
    const second = segments('beta plain', []);
    expect(first).toEqual([
      {text: 'alpha ', hit: false},
      {text: 'hit', hit: true},
    ]);
    // Rendering a different row afterwards must not observe any prior state.
    expect(second).toEqual([{text: 'beta plain', hit: false}]);
    expect(segments('alpha hit', [{start: 6, end: 9}])).toEqual(first);
  });
});
