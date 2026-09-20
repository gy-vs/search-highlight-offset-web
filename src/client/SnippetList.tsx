import {memo, useEffect, useRef, useState} from 'react';
import {segments, type Snippet} from '../shared/search';
import {visibleRange} from './virtual';

const ROW_HEIGHT = 72;
const VIEWPORT = 360;
const OVERSCAN = 3;

/**
 * A single snippet row. It is intentionally stateless: the highlight is
 * derived purely from this row's own `snippet` prop, so when the virtual list
 * recycles a row for different data there is no leftover highlight from the
 * previous occupant.
 */
export const SnippetRow = memo(function SnippetRow({snippet, top}: {snippet: Snippet; top: number}) {
  return (
    <div className="snippet-row" style={{transform: `translateY(${top}px)`}}>
      <p>
        {snippet.ellipsisBefore && <span className="ellipsis">…</span>}
        {segments(snippet.text, snippet.ranges).map((segment, index) =>
          segment.hit ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
        )}
        {snippet.ellipsisAfter && <span className="ellipsis">…</span>}
      </p>
    </div>
  );
});

export function SnippetList({snippets}: {snippets: Snippet[]}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // A new result set must not keep the previous scroll offset (and with it a
  // stale window of rows), so reset whenever the snippet identities change.
  const identity = snippets.map(snippet => snippet.id).join('|');
  useEffect(() => {
    setScrollTop(0);
    viewportRef.current?.scrollTo({top: 0});
  }, [identity]);
  const {start, end} = visibleRange(snippets.length, scrollTop, VIEWPORT, ROW_HEIGHT, OVERSCAN);
  return (
    <div
      className="snippet-viewport"
      ref={viewportRef}
      style={{height: VIEWPORT}}
      onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="snippet-canvas" style={{height: snippets.length * ROW_HEIGHT}}>
        {snippets.slice(start, end).map((snippet, index) => (
          <SnippetRow key={snippet.id} snippet={snippet} top={(start + index) * ROW_HEIGHT} />
        ))}
      </div>
    </div>
  );
}
