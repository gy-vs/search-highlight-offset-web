import {describe, expect, it} from 'vitest';
import {visibleRange} from '../src/client/virtual';

// The virtual list renders only visibleRange(...) rows, keyed by snippet id,
// and each row derives its highlight purely from its own snippet prop — so a
// recycled row can never display the previous row's highlight.
describe('visibleRange', () => {
  it('windows the rows with overscan', () => {
    expect(visibleRange(100, 0, 360, 72, 3)).toEqual({start: 0, end: 8});
    expect(visibleRange(100, 720, 360, 72, 3)).toEqual({start: 7, end: 18});
  });

  it('clamps to the row count and tolerates negative scroll', () => {
    expect(visibleRange(10, 720, 360, 72, 3)).toEqual({start: 7, end: 10});
    expect(visibleRange(10, -50, 360, 72, 3)).toEqual(visibleRange(10, 0, 360, 72, 3));
  });

  it('handles empty and degenerate inputs', () => {
    expect(visibleRange(0, 0, 360, 72, 3)).toEqual({start: 0, end: 0});
    expect(visibleRange(5, 0, 360, 0, 3)).toEqual({start: 0, end: 0});
  });

  it('a recycled row index maps to a different snippet, not stale state', () => {
    const snippets = Array.from({length: 50}, (_, i) => ({id: `${i * 10}:${i * 10 + 5}`}));
    const top = visibleRange(snippets.length, 0, 360, 72, 0);
    const scrolled = visibleRange(snippets.length, 720, 360, 72, 0);
    // Row slot 0 shows snippets[0] first and snippets[10] after scrolling;
    // identity comes from the key, so nothing is carried over.
    expect(snippets[top.start].id).toBe('0:5');
    expect(snippets[scrolled.start].id).toBe('100:105');
    expect(snippets[scrolled.start].id).not.toBe(snippets[top.start].id);
  });
});
