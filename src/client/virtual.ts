/**
 * Pure windowing math for the virtualized snippet list. Given scroll state it
 * returns the [start, end) slice of rows to render; rows themselves are
 * stateless, so recycling a row can never carry over another row's highlight.
 */
export function visibleRange(
  count: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  overscan: number,
): {start: number; end: number} {
  if (count <= 0 || rowHeight <= 0) return {start: 0, end: 0};
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / rowHeight);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + overscan),
  };
}
