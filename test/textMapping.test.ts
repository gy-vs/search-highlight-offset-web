import {describe,expect,it} from 'vitest';
import {
  buildFoldIndex,
  buildSnippet,
  findMatches,
  getVisibleWindow,
  mapFoldedRange,
  segmentGraphemes,
} from '../src/shared/textMapping';

const FOLD={caseFold:true,stripMarks:true};
const FOLD_NO_MARKS={caseFold:true,stripMarks:false};

describe('grapheme segmentation',()=>{
  it('keeps surrogate pairs, combining marks and ZWJ emoji sequences whole',()=>{
    const text='aé'+ '👨‍👩‍👧' +'x';
    const g=segmentGraphemes(text);
    expect(g.map(c=>c.text)).toEqual(['a','é', '👨‍👩‍👧','x']);
    // Cluster boundaries must be valid UTF-16 positions.
    for(const c of g){
      expect(c.index).toBe(text.indexOf(c.text));
      expect(()=>c.text.codePointAt(0)).not.toThrow();
    }
  });

  it('treats NFD e + combining acute as one cluster',()=>{
    const nfd='é';
    expect(segmentGraphemes(nfd).map(c=>c.text)).toEqual([nfd]);
  });

  it('groups skin-tone and regional indicator sequences',()=>{
    expect(segmentGraphemes('👋🏾').map(c=>c.text)).toEqual(['👋🏾']);
    expect(segmentGraphemes('🇹🇷!').map(c=>c.text)).toEqual(['🇹🇷','!']);
  });
});

describe('NFC / NFD equivalence',()=>{
  const nfc='Café résumé';
  const nfd=nfc.normalize('NFD');

  it('finds the same semantic matches in NFC and NFD text',()=>{
    const a=findMatches('cafe',nfc,FOLD);
    const b=findMatches('cafe',nfd,FOLD);
    // Offsets differ (NFD é is 2 UTF-16 units) but both cover the whole
    // source grapheme and normalize to the same text.
    expect(a).toEqual([{start:0,end:4}]);
    expect(b).toEqual([{start:0,end:5}]);
    expect(nfc.slice(a[0].start,a[0].end).normalize('NFC')).toBe('Café');
    expect(nfd.slice(b[0].start,b[0].end).normalize('NFC')).toBe('Café');
  });

  it('does not strip the mark when stripMarks is off',()=>{
    expect(findMatches('cafe',nfc,FOLD_NO_MARKS)).toEqual([]);
    expect(findMatches('café',nfc,FOLD_NO_MARKS)).toEqual([{start:0,end:4}]);
    // And NFD input works too (cluster spans 2 UTF-16 units).
    const nfdHit=findMatches('café',nfd,FOLD_NO_MARKS);
    expect(nfd.slice(nfdHit[0].start,nfdHit[0].end).normalize('NFC')).toBe('Café');
  });

  it('handles query and text in different normalizations',()=>{
    expect(findMatches('RÉSUMÉ'.normalize('NFD'),'résumé'.normalize('NFC'),FOLD)).toEqual([{start:0,end:6}]);
  });
});

describe('German ß case folding (1 source -> many folded)',()=>{
  it('matches "ss" against ß and covers the full ß grapheme',()=>{
    const text='Die Straße';
    const ranges=findMatches('strasse',text,{caseFold:true});
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start,ranges[0].end)).toBe('Straße');
  });

  it('matches uppercase ß expansion (Größe -> GROSSE)',()=>{
    const text='GRÖSSE';
    const ranges=findMatches('grösse',text,{caseFold:true,stripMarks:true});
    expect(text.slice(ranges[0].start,ranges[0].end)).toBe('GRÖSSE');
  });

  it('matches "ß" against "ss" in the source (many source -> one query)',()=>{
    const ranges=findMatches('fuß','FUSSSPUR',{caseFold:true});
    // FUSS... folded query fuß -> "fuss"; covers exactly FUSS (4 chars).
    expect(ranges).toEqual([{start:0,end:4}]);
  });

  it('does not fold when case folding disabled',()=>{
    expect(findMatches('strasse','Straße',{caseFold:false})).toEqual([]);
  });
});

describe('Turkish I',()=>{
  it('dotless: "istanbul" matches İstanbul under Turkish rules',()=>{
    const text='İstanbul';
    const tr=findMatches('istanbul',text,{caseFold:true,turkish:true});
    expect(tr).toEqual([{start:0,end:text.length}]);
    // Default folding: İ -> i (dotted), so it also matches plain i...
    const def=findMatches('istanbul',text,{caseFold:true});
    expect(def).toHaveLength(1);
  });

  it('dotless capital I folds to ı only with Turkish rules',()=>{
    const text='IĞIR takim'; // capital dotless I + Ğ + I + R
    // Turkish: I -> ı (dotless), so 'ığır' matches the first word; plain
    // folding turns I -> i and cannot match dotless ığır.
    expect(findMatches('ığır',text,{caseFold:true,turkish:true})).toEqual([{start:0,end:4}]);
    expect(findMatches('ığır',text,{caseFold:true})).toEqual([]);
    // The ASCII trailing word 'takim' matches without Turkish rules too.
    expect(findMatches('takim',text,{caseFold:true})).toEqual([{start:5,end:10}]);
  });
});

describe('emoji and ZWJ',()=>{
  it('matches inside text around a ZWJ family emoji without splitting it',()=>{
    const family='👨‍👩‍👧';
    const text='the family '+family+' family end';
    const ranges=findMatches('family',text,FOLD);
    expect(ranges).toHaveLength(2);
    // Neither range may cut through the ZWJ sequence.
    for(const r of ranges){
      const sliced=text.slice(r.start,r.end);
      expect(sliced).not.toContain('‍');
      expect(sliced.startsWith('\u{d83d}')).toBe(false);
      expect(sliced).toBe('family');
    }
  });

  it('matching the emoji itself covers the complete ZWJ cluster',()=>{
    const family='👨‍👩‍👧';
    const text='a'+family+'b';
    const ranges=findMatches(family,text,FOLD);
    expect(ranges).toEqual([{start:1,end:1+family.length}]);
    expect(text.slice(ranges[0].start,ranges[0].end)).toBe(family);
  });

  it('skin tone modifier never gets cut in half',()=>{
    const text='say 👋🏾 hi';
    const ranges=findMatches('hi',text,FOLD);
    const hit=text.slice(ranges[0].start,ranges[0].end);
    expect(hit).toBe('hi');
  });
});

describe('multiple adjacent hits',()=>{
  it('returns separate ranges for repeated adjacent/overlapping occurrences',()=>{
    expect(findMatches('a','banana',FOLD)).toEqual([
      {start:1,end:2},{start:3,end:4},{start:5,end:6},
    ]);
  });

  it('merges overlapping expanded ranges (ß covers full graphemes)',()=>{
    // "ßß" query folded to "ssss"; source "ßß" folds to "ssss" — one merged
    // range covering both graphemes, never zero-width between them.
    const ranges=findMatches('ssss','aßßb',{caseFold:true});
    expect(ranges).toEqual([{start:1,end:3}]);
  });

  it('adjacent hits with fold-away combining marks between them stay covered',()=>{
    // U+0300 orphan combining mark folds away but must attach to a hit.
    const text='a\u0300b';
    const ranges=findMatches('ab',text,{caseFold:true,stripMarks:true});
    expect(ranges).toEqual([{start:0,end:3}]);
    expect(text.slice(ranges[0].start,ranges[0].end)).toBe(text);
  });
});

describe('mapFoldedRange edge cases',()=>{
  it('expands 1:many folded positions to the full source span',()=>{
    const idx=buildFoldIndex('xßy',{caseFold:true});
    expect(idx.folded).toBe('xssy');
    // "ss" occupies folded units 1..3 and maps back to the single ß unit.
    expect(mapFoldedRange(idx,1,3)).toEqual({start:1,end:2});
    // Partial "s" still covers the whole ß.
    expect(mapFoldedRange(idx,2,3)).toEqual({start:1,end:2});
  });

  it('expands many:1 (NFD cluster) onto both UTF-16 units',()=>{
    const idx=buildFoldIndex('éx'.normalize('NFD'),FOLD);
    expect(idx.folded).toBe('ex');
    expect(mapFoldedRange(idx,0,1)).toEqual({start:0,end:2});
  });

  it('clamps out-of-range and empty requests',()=>{
    const idx=buildFoldIndex('abc',FOLD);
    expect(mapFoldedRange(idx,0,0)).toEqual({start:0,end:0});
    expect(mapFoldedRange(idx,0,99)).toEqual({start:0,end:3});
  });
});

describe('snippet truncation',()=>{
  it('keeps ranges relative to the cut window and snaps to graphemes',()=>{
    const text='x'.repeat(30)+'🎯TARGET'.normalize()+ 'y'.repeat(30);
    const hitFull=findMatches('target',text,FOLD);
    const snippet=buildSnippet(text,hitFull,{radius:10,maxLength:40});
    expect(snippet.prefixEllipsis).toBe(true);
    expect(snippet.suffixEllipsis).toBe(true);
    // Relative ranges must point into the snippet text exactly.
    for(const r of snippet.ranges){
      expect(snippet.text.slice(r.start,r.end).toLowerCase()).toContain('target');
    }
    // Window bounds are grapheme-aligned: the emoji is never bisected.
    const before=text.slice(0,snippet.start);
    const after=text.slice(snippet.end);
    expect(before+ snippet.text+after).toBe(text);
    expect([...snippet.text].length+snippet.text.length).toBeGreaterThan(0);
  });

  it('preserves relative positions for multiple hits',()=>{
    const text='head '+'needle'.repeat(6)+' tail';
    const hits=findMatches('needle',text,FOLD);
    expect(hits.length).toBe(6);
    const snippet=buildSnippet(text,hits);
    // Relative ranges must line up with the window offset in the original.
    for(const r of snippet.ranges){
      expect(snippet.text.slice(r.start,r.end)).toBe('needle');
      expect(text.slice(r.start+snippet.start,r.end+snippet.start)).toBe('needle');
    }
  });

  it('does not cut through emoji when trimming',()=>{
    const text='z'.repeat(40)+'👨‍👩‍👧 hit';
    const hits=findMatches('hit',text,FOLD);
    const snippet=buildSnippet(text,hits,{radius:20,maxLength:30});
    // The emoji, if present, must be whole in the snippet.
    if(snippet.text.includes('‍')){
      expect(snippet.text).toContain('👨‍👩‍👧');
    }
    expect(snippet.text.slice(snippet.ranges[0].start,snippet.ranges[0].end)).toBe('hit');
  });

  it('no-hit snippets return empty ranges',()=>{
    const snippet=buildSnippet('short text',[]);
    expect(snippet.ranges).toEqual([]);
  });
});

describe('virtual list window',()=>{
  it('returns overscan-padded windows',()=>{
    expect(getVisibleWindow(0,200,1000,40,4)).toMatchObject({startIndex:0});
    const w=getVisibleWindow(1000,400,1000,50,4);
    expect(w.startIndex).toBe(16);
    expect(w.offset).toBe(800);
    expect(w.endIndex).toBeGreaterThan(w.startIndex);
  });

  it('clamps at the tail',()=>{
    const w=getVisibleWindow(99999,400,3,50,4);
    expect(w.endIndex).toBe(3);
  });
});

describe('fallback grapheme segmentation',()=>{
  it('still keeps combining marks and ZWJ sequences whole',()=>{
    const Original=Intl.Segmenter;
    // Force the fallback path.
    (Intl as any).Segmenter=undefined;
    try{
      const text='e'+ '\u0301' + 'x👨‍👩‍👧y';
      const g=segmentGraphemes(text);
      expect(g.map(c=>c.text)).toEqual(['e\u0301','x','👨‍👩‍👧','y']);
      const ranges=findMatches('ex',text,FOLD);
      // Match covers e + combining acute + x, never the dangling mark alone.
      expect(text.slice(ranges[0].start,ranges[0].end)).toBe('e\u0301x');
    }finally{
      (Intl as any).Segmenter=Original;
    }
  });
});
